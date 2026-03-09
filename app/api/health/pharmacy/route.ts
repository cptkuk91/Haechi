import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  extractResultWarningFromXml,
  extractXmlItems,
  extractXmlTagValue,
} from '@/app/api/_shared/xml-utils';
import {
  DEFAULT_HEALTH_PHARMACY_MAP_FEATURE_LIMIT,
  includesHealthPharmacyCoordinate,
  parseHealthPharmacyBbox,
  clampHealthPharmacyFeatureLimit,
} from '@/lib/health-pharmacy';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyFullDown';
const DEFAULT_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 60;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 100;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60_000;

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

interface PharmacyDatasetCache {
  rows: JsonRecord[];
  totalCount: number | null;
  warnings: string[];
  fetchedAt: number;
}

interface PharmacyScheduleContext {
  dayIndex: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  dayLabel: string;
  currentTimeValue: string;
}

interface PharmacyOperatingState {
  openNow: boolean | null;
  statusLabel: string;
  todayHours: string | null;
  todayStartTime: string | null;
  todayCloseTime: string | null;
  dayLabel: string;
}

const WEEKDAY_INDEX: Record<string, PharmacyScheduleContext['dayIndex']> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

let pharmacyDatasetCache: PharmacyDatasetCache | null = null;

function readPharmacyXmlTag(source: string, tag: string): string | null {
  return extractXmlTagValue(source, tag, {
    decodeEntities: true,
    compactWhitespace: true,
  });
}

function extractPharmacyRowsFromXml(xml: string): JsonRecord[] {
  const matches = extractXmlItems(xml, 'item');
  const rows: JsonRecord[] = [];

  for (const itemXml of matches) {
    const row: JsonRecord = {
      dutyAddr: readPharmacyXmlTag(itemXml, 'dutyAddr'),
      dutyEtc: readPharmacyXmlTag(itemXml, 'dutyEtc'),
      dutyInf: readPharmacyXmlTag(itemXml, 'dutyInf'),
      dutyMapimg: readPharmacyXmlTag(itemXml, 'dutyMapimg'),
      dutyName: readPharmacyXmlTag(itemXml, 'dutyName'),
      dutyTel1: readPharmacyXmlTag(itemXml, 'dutyTel1'),
      dutyUrl: readPharmacyXmlTag(itemXml, 'dutyUrl'),
      hpid: readPharmacyXmlTag(itemXml, 'hpid'),
      postCdn1: readPharmacyXmlTag(itemXml, 'postCdn1'),
      postCdn2: readPharmacyXmlTag(itemXml, 'postCdn2'),
      wgs84Lon: readPharmacyXmlTag(itemXml, 'wgs84Lon'),
      wgs84Lat: readPharmacyXmlTag(itemXml, 'wgs84Lat'),
    };

    for (let dayIndex = 1; dayIndex <= 8; dayIndex += 1) {
      row[`dutyTime${dayIndex}s`] = readPharmacyXmlTag(itemXml, `dutyTime${dayIndex}s`);
      row[`dutyTime${dayIndex}c`] = readPharmacyXmlTag(itemXml, `dutyTime${dayIndex}c`);
    }

    rows.push(row);
  }

  return rows;
}

async function fetchPharmacyPage(args: {
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

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      rows: [],
      totalCount: null,
      warning: `NMC pharmacy upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'NMC pharmacy upstream returned empty body',
    };
  }

  const warning = extractResultWarningFromXml(text, {
    sourceLabel: 'NMC pharmacy API',
    decodeEntities: true,
    compactWhitespace: true,
  }) ?? undefined;

  return {
    rows: extractPharmacyRowsFromXml(text),
    totalCount: toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null,
    warning,
  };
}

async function loadPharmacyDataset(args: {
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  cacheTtlMs: number;
}): Promise<PharmacyDatasetCache> {
  const now = Date.now();
  if (pharmacyDatasetCache && now - pharmacyDatasetCache.fetchedAt < args.cacheTtlMs) {
    return pharmacyDatasetCache;
  }

  const warnings: string[] = [];
  const rows: JsonRecord[] = [];
  let totalCount: number | null = null;
  let totalPages = 1;

  for (let pageNo = 1; pageNo <= totalPages && pageNo <= args.maxPages; pageNo += 1) {
    const pageResult = await fetchPharmacyPage({
      upstreamUrl: args.upstreamUrl,
      apiKey: args.apiKey,
      pageNo,
      pageSize: args.pageSize,
    });

    if (pageResult.warning) {
      warnings.push(pageResult.warning);
    }

    if (pageResult.totalCount !== null && totalCount === null) {
      totalCount = pageResult.totalCount;
      totalPages = Math.max(1, Math.ceil(pageResult.totalCount / args.pageSize));
    }

    if (pageResult.rows.length === 0) {
      break;
    }

    rows.push(...pageResult.rows);
  }

  if (totalCount !== null && totalCount > args.pageSize * args.maxPages) {
    warnings.push(
      `NMC pharmacy dataset exceeds configured max pages (${args.maxPages}); results may be truncated`
    );
  }

  if (rows.length > 0) {
    pharmacyDatasetCache = {
      rows,
      totalCount,
      warnings: Array.from(new Set(warnings)),
      fetchedAt: now,
    };
    return pharmacyDatasetCache;
  }

  if (pharmacyDatasetCache) {
    return {
      ...pharmacyDatasetCache,
      warnings: Array.from(new Set([
        ...pharmacyDatasetCache.warnings,
        ...warnings,
        'Using stale pharmacy cache after upstream refresh failure',
      ])),
    };
  }

  return {
    rows: [],
    totalCount,
    warnings: Array.from(new Set(warnings)),
    fetchedAt: now,
  };
}

function normalizeTimeDigits(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 4) return null;
  return digits;
}

function formatTimeLabel(value: string | null): string | null {
  const digits = normalizeTimeDigits(value);
  if (!digits) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function getCurrentKstScheduleContext(now = new Date()): PharmacyScheduleContext {
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'Asia/Seoul',
  }).format(now);
  const dayLabel = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'long',
    timeZone: 'Asia/Seoul',
  }).format(now);
  const currentTimeValue = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(now).replace(':', '');

  return {
    dayIndex: WEEKDAY_INDEX[weekday] ?? 1,
    dayLabel,
    currentTimeValue,
  };
}

function classifyPharmacyOperatingState(
  row: JsonRecord,
  context: PharmacyScheduleContext
): PharmacyOperatingState {
  const startTime = pickString(row, [`dutyTime${context.dayIndex}s`]);
  const closeTime = pickString(row, [`dutyTime${context.dayIndex}c`]);
  const todayStartTime = formatTimeLabel(startTime);
  const todayCloseTime = formatTimeLabel(closeTime);
  const todayHours = todayStartTime && todayCloseTime
    ? `${todayStartTime} - ${todayCloseTime}`
    : null;

  if (!todayStartTime || !todayCloseTime || !startTime || !closeTime) {
    return {
      openNow: null,
      statusLabel: '현재 정보 없음',
      todayHours: null,
      todayStartTime: null,
      todayCloseTime: null,
      dayLabel: context.dayLabel,
    };
  }

  const currentValue = Number(context.currentTimeValue);
  const openValue = Number(startTime);
  const closeValue = Number(closeTime);
  const openNow = openValue <= closeValue
    ? currentValue >= openValue && currentValue <= closeValue
    : currentValue >= openValue || currentValue <= closeValue;

  return {
    openNow,
    statusLabel: openNow ? '운영 중' : '영업 종료',
    todayHours,
    todayStartTime,
    todayCloseTime,
    dayLabel: context.dayLabel,
  };
}

function toPharmacyFeatures(
  rows: JsonRecord[],
  bbox: ReturnType<typeof parseHealthPharmacyBbox>,
  featureLimit: number
): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const dedupe = new Set<string>();
  const scheduleContext = getCurrentKstScheduleContext();

  for (const row of rows) {
    const lng = pickNumber(row, ['wgs84Lon', 'longitude', 'lon', 'lng']);
    const lat = pickNumber(row, ['wgs84Lat', 'latitude', 'lat']);
    if (lng === null || lat === null) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;
    if (!includesHealthPharmacyCoordinate(bbox, [lng, lat])) continue;

    const hpid = pickString(row, ['hpid']);
    const featureId = hpid ?? `pharmacy-${lng.toFixed(6)}-${lat.toFixed(6)}`;
    if (dedupe.has(featureId)) continue;
    dedupe.add(featureId);

    const name = pickString(row, ['dutyName']) ?? '약국';
    const address = pickString(row, ['dutyAddr']);
    const phone = pickString(row, ['dutyTel1']);
    const notes = pickString(row, ['dutyEtc']);
    const description = pickString(row, ['dutyInf']);
    const homepage = pickString(row, ['dutyUrl']);
    const mapImage = pickString(row, ['dutyMapimg']);
    const operatingState = classifyPharmacyOperatingState(row, scheduleContext);

    features.push({
      type: 'Feature',
      id: featureId,
      geometry: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      properties: {
        id: featureId,
        layerKind: 'pharmacy',
        name,
        dutyName: name,
        address,
        dutyAddr: address,
        phone,
        dutyTel1: phone,
        hpid,
        notes,
        dutyEtc: notes,
        description,
        dutyInf: description,
        homepage,
        dutyUrl: homepage,
        mapImage,
        dutyMapimg: mapImage,
        operatingNow: operatingState.openNow,
        operatingStatusLabel: operatingState.statusLabel,
        operatingDayLabel: operatingState.dayLabel,
        todayHours: operatingState.todayHours,
        todayStartTime: operatingState.todayStartTime,
        todayCloseTime: operatingState.todayCloseTime,
        source: 'nmc-pharmacy',
        sourceLabel: 'NMC Pharmacy API',
      },
    });

    if (features.length >= featureLimit) {
      break;
    }
  }

  return features;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const bbox = parseHealthPharmacyBbox(requestUrl.searchParams.get('bbox'));
  const apiKey =
    process.env.TEAM2_HEALTH_PHARMACY_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_HEALTH_PHARMACY_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_HEALTH_API_KEY / TEAM2_PUBLIC_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_HEALTH_PHARMACY_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_PHARMACY_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_PHARMACY_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const cacheTtlMs = toPositiveInt(
    process.env.TEAM2_HEALTH_PHARMACY_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS
  );
  const featureLimit = clampHealthPharmacyFeatureLimit(
    toPositiveInt(
      requestUrl.searchParams.get('limit'),
      toPositiveInt(
        process.env.TEAM2_HEALTH_PHARMACY_MAP_FEATURE_LIMIT,
        DEFAULT_HEALTH_PHARMACY_MAP_FEATURE_LIMIT
      )
    )
  );

  const dataset = await loadPharmacyDataset({
    upstreamUrl,
    apiKey,
    pageSize,
    maxPages,
    cacheTtlMs,
  });

  const features = toPharmacyFeatures(dataset.rows, bbox, featureLimit);
  const source = dataset.rows.length > 0 ? 'upstream' : 'mock';

  return NextResponse.json(
    {
      source,
      updatedAt: new Date(dataset.fetchedAt).toISOString(),
      data: {
        type: 'FeatureCollection',
        features,
      },
      warnings: dataset.warnings,
      meta: {
        totalRows: dataset.rows.length,
        totalCount: dataset.totalCount,
        featureLimit,
        featureCount: features.length,
      },
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': source,
      },
    }
  );
}
