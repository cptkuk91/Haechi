import { NextResponse } from 'next/server';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getEgytListInfoInqire';
const DEFAULT_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 50;

type JsonRecord = Record<string, unknown>;

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is JsonRecord => isRecord(row));
  }
  if (isRecord(value)) {
    return [value];
  }
  return [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickNumber(row: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function pickString(row: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string') {
      const normalized = compactText(value);
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractRowsFromJson(raw: unknown): JsonRecord[] {
  if (Array.isArray(raw)) return toArray(raw);
  if (!isRecord(raw)) return [];

  const dataRows = toArray(raw.data);
  if (dataRows.length > 0) return dataRows;

  const response = isRecord(raw.response) ? raw.response : null;
  const body = response && isRecord(response.body) ? response.body : null;
  const items = body?.items;
  if (isRecord(items)) {
    const itemRows = toArray(items.item);
    if (itemRows.length > 0) return itemRows;
  }

  const bodyRows = toArray(body?.items);
  if (bodyRows.length > 0) return bodyRows;

  const itemRows = toArray(raw.item);
  if (itemRows.length > 0) return itemRows;

  return [];
}

function extractTotalCountFromJson(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const response = isRecord(raw.response) ? raw.response : null;
  const body = response && isRecord(response.body) ? response.body : null;

  const candidates: unknown[] = [
    body?.totalCount,
    raw.totalCount,
    raw.count,
    response?.count,
  ];
  for (const candidate of candidates) {
    const parsed = toPositiveInt(candidate, 0);
    if (parsed > 0) return parsed;
  }
  return null;
}

function extractResultWarningFromJson(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const response = isRecord(raw.response) ? raw.response : null;
  const header = response && isRecord(response.header) ? response.header : null;
  const code = typeof header?.resultCode === 'string' ? header.resultCode : null;
  const message = typeof header?.resultMsg === 'string' ? header.resultMsg : null;
  if (!code) return null;
  if (code === '00' || code === 'INFO-000' || code === 'NORMAL_SERVICE') return null;
  return `NMC emergency API [${code}] ${message ?? 'Unknown error'}`;
}

function extractXmlTagValue(source: string, tag: string): string | null {
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match?.[1]?.trim() ?? null;
}

function extractRowsFromXml(xml: string): JsonRecord[] {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const rows: JsonRecord[] = [];
  for (const itemXml of matches) {
    rows.push({
      hpid: extractXmlTagValue(itemXml, 'hpid'),
      dutyName: extractXmlTagValue(itemXml, 'dutyName'),
      dutyEmclsName: extractXmlTagValue(itemXml, 'dutyEmclsName'),
      dutyAddr: extractXmlTagValue(itemXml, 'dutyAddr'),
      dutyTel3: extractXmlTagValue(itemXml, 'dutyTel3'),
      dutyTel1: extractXmlTagValue(itemXml, 'dutyTel1'),
      wgs84Lon: extractXmlTagValue(itemXml, 'wgs84Lon'),
      wgs84Lat: extractXmlTagValue(itemXml, 'wgs84Lat'),
    });
  }
  return rows;
}

async function fetchEmergencyRoomPage(args: {
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
      warning: `NMC emergency upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'NMC emergency upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    const warning = extractResultWarningFromJson(json) ?? undefined;
    return {
      rows: extractRowsFromJson(json),
      totalCount: extractTotalCountFromJson(json),
      warning,
    };
  } catch {
    const rows = extractRowsFromXml(text);
    const totalCount = toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null;
    return {
      rows,
      totalCount,
    };
  }
}

function toEmergencyRoomFeatures(rows: JsonRecord[]): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const dedupe = new Set<string>();

  for (const row of rows) {
    const lng = pickNumber(row, ['wgs84Lon', 'wgs84lon', 'longitude', 'lon', 'lng', 'mapX', 'xPos', 'x']);
    const lat = pickNumber(row, ['wgs84Lat', 'wgs84lat', 'latitude', 'lat', 'mapY', 'yPos', 'y']);
    if (lng === null || lat === null) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;

    const hpid = pickString(row, ['hpid', 'HPID', 'id']);
    const name = pickString(row, ['dutyName', 'name', 'hospitalName']) ?? '응급의료기관';
    const institutionType = pickString(row, ['dutyEmclsName', 'institutionType']) ?? '응급의료기관';
    const address = pickString(row, ['dutyAddr', 'address']);
    const phone = pickString(row, ['dutyTel3', 'dutyTel1', 'phone']);

    const featureId = hpid ?? `er-${lng.toFixed(6)}-${lat.toFixed(6)}`;
    if (dedupe.has(featureId)) continue;
    dedupe.add(featureId);

    features.push({
      type: 'Feature',
      id: featureId,
      geometry: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      properties: {
        id: featureId,
        hpid,
        name,
        institutionType,
        address,
        phone,
        source: 'nmc',
      },
    });
  }

  return features;
}

export async function GET() {
  const apiKey = process.env.TEAM2_HEALTH_API_KEY ?? process.env.TEAM2_PUBLIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_HEALTH_API_KEY (or TEAM2_PUBLIC_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_HEALTH_EMERGENCY_ROOMS_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_EMERGENCY_ROOMS_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_EMERGENCY_ROOMS_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );

  const warnings: string[] = [];
  const rows: JsonRecord[] = [];

  let totalPages = 1;
  for (let pageNo = 1; pageNo <= totalPages && pageNo <= maxPages; pageNo += 1) {
    const pageResult = await fetchEmergencyRoomPage({
      upstreamUrl,
      apiKey,
      pageNo,
      pageSize,
    });

    if (pageResult.warning) warnings.push(pageResult.warning);
    rows.push(...pageResult.rows);

    if (pageResult.totalCount && pageResult.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(pageResult.totalCount / pageSize));
    } else if (pageResult.rows.length < pageSize) {
      break;
    }
  }

  const features = toEmergencyRoomFeatures(rows);
  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['Emergency room upstream returned no coordinate features'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  return NextResponse.json(
    {
      source: 'upstream',
      updatedAt: new Date().toISOString(),
      data: {
        type: 'FeatureCollection',
        features,
      } satisfies GeoJSON.FeatureCollection,
      warnings,
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': 'upstream',
      },
    }
  );
}
