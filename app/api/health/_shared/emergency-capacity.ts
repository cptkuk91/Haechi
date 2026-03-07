import {
  clampInt,
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import { extractXmlItems, extractXmlTagValue } from '@/app/api/_shared/xml-utils';

const DEFAULT_CAPACITY_UPSTREAM_URL = 'https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEmrrmRltmUsefulSckbdInfoInqire';
const DEFAULT_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 5;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 50;
const CACHE_TTL_MS = 60_000;

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

export interface EmergencyCapacitySnapshot {
  hpid: string;
  name: string | null;
  availableBeds: number | null;
  rawAvailableBeds: number | null;
  overloadBeds: number;
  severity: 'info' | 'warning' | 'critical' | null;
  lastUpdated: string | null;
  availableOperatingRooms: number | null;
  availableGeneralBeds: number | null;
  availableNeonatalIcuBeds: number | null;
  ctAvailable: boolean | null;
  mriAvailable: boolean | null;
  ventilatorAvailable: boolean | null;
  ecmoAvailable: boolean | null;
  crrtAvailable: boolean | null;
  angiographyAvailable: boolean | null;
  oxygenAvailable: boolean | null;
  incubatorAvailable: boolean | null;
}

interface CachedCapacityIndex {
  fetchedAt: number;
  key: string;
  warnings: string[];
  byHpid: Map<string, EmergencyCapacitySnapshot>;
}

let cachedIndex: CachedCapacityIndex | null = null;

function extractRowsFromXml(xml: string): JsonRecord[] {
  const matches = extractXmlItems(xml, 'item');
  const rows: JsonRecord[] = [];
  for (const itemXml of matches) {
    rows.push({
      dutyName: extractXmlTagValue(itemXml, 'dutyName'),
      dutyTel3: extractXmlTagValue(itemXml, 'dutyTel3'),
      hpid: extractXmlTagValue(itemXml, 'hpid'),
      hvec: extractXmlTagValue(itemXml, 'hvec'),
      hvidate: extractXmlTagValue(itemXml, 'hvidate'),
      hvoc: extractXmlTagValue(itemXml, 'hvoc'),
      hvgc: extractXmlTagValue(itemXml, 'hvgc'),
      hvncc: extractXmlTagValue(itemXml, 'hvncc'),
      hvctayn: extractXmlTagValue(itemXml, 'hvctayn'),
      hvmriayn: extractXmlTagValue(itemXml, 'hvmriayn'),
      hvventiayn: extractXmlTagValue(itemXml, 'hvventiayn'),
      hvecmoayn: extractXmlTagValue(itemXml, 'hvecmoayn'),
      hvcrrtayn: extractXmlTagValue(itemXml, 'hvcrrtayn'),
      hvangioayn: extractXmlTagValue(itemXml, 'hvangioayn'),
      hvoxyayn: extractXmlTagValue(itemXml, 'hvoxyayn'),
      hvincuayn: extractXmlTagValue(itemXml, 'hvincuayn'),
    });
  }
  return rows;
}

async function fetchCapacityPage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
  pageSize: number;
}): Promise<PageFetchResult> {
  const url = new URL(args.upstreamUrl);
  if (!url.searchParams.has('serviceKey')) {
    url.searchParams.set('serviceKey', args.apiKey);
  }
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));
  url.searchParams.set('_type', 'json');
  url.searchParams.set('resultType', 'json');

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      rows: [],
      totalCount: null,
      warning: `NMC emergency capacity upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'NMC emergency capacity upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    const warning = extractResultWarningFromCommonJson(json, 'NMC emergency capacity API') ?? undefined;
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json),
      warning,
    };
  } catch {
    return {
      rows: extractRowsFromXml(text),
      totalCount: toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null,
    };
  }
}

function parseKstTimestamp(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isFinite(value)
    ? String(Math.trunc(value))
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!/^\d{14}$/.test(raw)) return null;

  const yyyy = raw.slice(0, 4);
  const mm = raw.slice(4, 6);
  const dd = raw.slice(6, 8);
  const hh = raw.slice(8, 10);
  const mi = raw.slice(10, 12);
  const ss = raw.slice(12, 14);
  return new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`).toISOString();
}

function parseYesNo(value: unknown): boolean | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'Y') return true;
  if (normalized === 'N') return false;
  return null;
}

function inferSeverity(availableBeds: number | null): EmergencyCapacitySnapshot['severity'] {
  if (availableBeds === null) return null;
  if (availableBeds <= 0) return 'critical';
  if (availableBeds <= 3) return 'warning';
  return 'info';
}

function toCapacitySnapshot(row: JsonRecord): EmergencyCapacitySnapshot | null {
  const hpid = pickString(row, ['hpid', 'HPID']);
  if (!hpid) return null;

  const rawAvailableBeds = pickNumber(row, ['hvec']);
  const availableBeds = rawAvailableBeds === null ? null : Math.max(0, Math.trunc(rawAvailableBeds));
  const overloadBeds = rawAvailableBeds !== null && rawAvailableBeds < 0 ? Math.abs(Math.trunc(rawAvailableBeds)) : 0;

  return {
    hpid,
    name: pickString(row, ['dutyName', 'name']),
    availableBeds,
    rawAvailableBeds,
    overloadBeds,
    severity: inferSeverity(rawAvailableBeds),
    lastUpdated: parseKstTimestamp(row.hvidate),
    availableOperatingRooms: pickNumber(row, ['hvoc']),
    availableGeneralBeds: pickNumber(row, ['hvgc']),
    availableNeonatalIcuBeds: pickNumber(row, ['hvncc']),
    ctAvailable: parseYesNo(row.hvctayn),
    mriAvailable: parseYesNo(row.hvmriayn),
    ventilatorAvailable: parseYesNo(row.hvventiayn),
    ecmoAvailable: parseYesNo(row.hvecmoayn),
    crrtAvailable: parseYesNo(row.hvcrrtayn),
    angiographyAvailable: parseYesNo(row.hvangioayn),
    oxygenAvailable: parseYesNo(row.hvoxyayn),
    incubatorAvailable: parseYesNo(row.hvincuayn),
  };
}

export function toCapacityFeatureProperties(snapshot: EmergencyCapacitySnapshot | null | undefined): Record<string, unknown> {
  if (!snapshot) return {};

  return {
    availableBeds: snapshot.availableBeds,
    rawAvailableBeds: snapshot.rawAvailableBeds,
    overloadBeds: snapshot.overloadBeds > 0 ? snapshot.overloadBeds : null,
    severity: snapshot.severity,
    lastUpdated: snapshot.lastUpdated,
    availableOperatingRooms: snapshot.availableOperatingRooms,
    availableGeneralBeds: snapshot.availableGeneralBeds,
    availableNeonatalIcuBeds: snapshot.availableNeonatalIcuBeds,
    ctAvailable: snapshot.ctAvailable,
    mriAvailable: snapshot.mriAvailable,
    ventilatorAvailable: snapshot.ventilatorAvailable,
    ecmoAvailable: snapshot.ecmoAvailable,
    crrtAvailable: snapshot.crrtAvailable,
    angiographyAvailable: snapshot.angiographyAvailable,
    oxygenAvailable: snapshot.oxygenAvailable,
    incubatorAvailable: snapshot.incubatorAvailable,
  };
}

export async function fetchEmergencyCapacityIndex(args: {
  apiKey: string;
  upstreamUrl?: string;
  pageSize?: number;
  maxPages?: number;
}): Promise<{ byHpid: Map<string, EmergencyCapacitySnapshot>; warnings: string[] }> {
  const upstreamUrl = args.upstreamUrl ?? process.env.TEAM2_HEALTH_EMERGENCY_CAPACITY_UPSTREAM_URL ?? DEFAULT_CAPACITY_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(args.pageSize ?? process.env.TEAM2_HEALTH_EMERGENCY_CAPACITY_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(args.maxPages ?? process.env.TEAM2_HEALTH_EMERGENCY_CAPACITY_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const cacheKey = `${args.apiKey}|${upstreamUrl}|${pageSize}|${maxPages}`;

  if (cachedIndex && cachedIndex.key === cacheKey && Date.now() - cachedIndex.fetchedAt < CACHE_TTL_MS) {
    return {
      byHpid: new Map(cachedIndex.byHpid),
      warnings: [...cachedIndex.warnings],
    };
  }

  const warnings: string[] = [];
  const rows: JsonRecord[] = [];

  let totalPages = 1;
  for (let pageNo = 1; pageNo <= totalPages && pageNo <= maxPages; pageNo += 1) {
    const page = await fetchCapacityPage({
      upstreamUrl,
      apiKey: args.apiKey,
      pageNo,
      pageSize,
    });

    if (page.warning) warnings.push(page.warning);
    rows.push(...page.rows);

    if (page.totalCount && page.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(page.totalCount / pageSize));
    } else if (page.rows.length < pageSize) {
      break;
    }
  }

  const byHpid = new Map<string, EmergencyCapacitySnapshot>();
  for (const row of rows) {
    const snapshot = toCapacitySnapshot(row);
    if (!snapshot) continue;
    byHpid.set(snapshot.hpid, snapshot);
  }

  cachedIndex = {
    key: cacheKey,
    fetchedAt: Date.now(),
    warnings: [...warnings],
    byHpid: new Map(byHpid),
  };

  return { byHpid, warnings };
}
