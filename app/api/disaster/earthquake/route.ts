import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  isRecord,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/1360000/EqkInfoService/getEqkMsg';
const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 200;
const CACHE_TTL_MS = 60_000;
const SUCCESS_CODES = new Set(['00', '03', 'NORMAL_SERVICE']);
const SEOUL_TIME_ZONE = 'Asia/Seoul';

interface EarthquakePeriod {
  start: string;
  end: string;
}

interface EarthquakeFetchResult {
  rows: JsonRecord[];
  totalCount: number;
  resultCode: string | null;
  resultMsg: string | null;
  warning?: string;
}

interface CachedResult {
  json: Record<string, unknown>;
  source: 'mock' | 'upstream';
  cachedAt: number;
}

type EarthquakeFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    id: string;
    layerKind: string;
    name: string;
    locationLabel: string;
    magnitude: number | null;
    baseMagnitude: number | null;
    intensity: number;
    depthKm: number | null;
    intensityLabel: string | null;
    occurredAt: string | null;
    announcedAt: string | null;
    occurredAtRaw: string | null;
    announcedAtRaw: string | null;
    stationId: string | null;
    bulletinType: string | null;
    bulletinSequence: number | null;
    referenceCount: number | null;
    remarks: string | null;
    corrections: string | null;
    imageUrl: string | null;
    affectsDomestic: boolean;
    severity: 'info' | 'warning' | 'critical';
    source: 'upstream';
    sourceLabel: string;
    updatedAt: string;
  }
>;

let cache = new Map<string, CachedResult>();

function formatYmdInSeoul(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}${month}${day}`;
}

function normalizeYmd(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

function resolvePeriod(searchParams: URLSearchParams): EarthquakePeriod {
  const end = normalizeYmd(searchParams.get('toTmFc')) ?? formatYmdInSeoul(new Date());
  const defaultStart = new Date(Date.now() - 2 * 24 * 60 * 60_000);
  const start = normalizeYmd(searchParams.get('fromTmFc')) ?? formatYmdInSeoul(defaultStart);

  if (start <= end) return { start, end };
  return { start: end, end: start };
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function formatDateTimeToken(value: string | null): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length >= 14) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
  }
  if (digits.length >= 12) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  }
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return value;
}

function toSeverity(magnitude: number | null): 'info' | 'warning' | 'critical' {
  if (magnitude === null) return 'info';
  if (magnitude >= 4.5) return 'critical';
  if (magnitude >= 3.5) return 'warning';
  return 'info';
}

function buildEarthquakeFeatures(rows: JsonRecord[], updatedAt: string): EarthquakeFeature[] {
  const features = rows
    .map((row, index) => {
      const lon = pickNumber(row, ['lon']);
      const lat = pickNumber(row, ['lat']);
      if (lon === null || lat === null) return null;
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;

      const locationLabel = pickString(row, ['loc']) ?? '지진 진앙지';
      const magnitude = pickNumber(row, ['mt']);
      const depthKm = pickNumber(row, ['dep']);
      const intensityLabel = pickString(row, ['inT']);
      const occurredAtRaw = toText(row.tmEqk);
      const announcedAtRaw = toText(row.tmFc);
      const stationId = toText(row.stnId);
      const bulletinType = toText(row.fcTp);
      const bulletinSequence = toPositiveInt(row.tmSeq, 0) || null;
      const referenceCount = toPositiveInt(row.cnt, 0) || null;
      const remarks = pickString(row, ['rem']);
      const corrections = pickString(row, ['cor']);
      const imageUrl = pickString(row, ['img'], (value) => value.trim());
      const affectsDomestic = !(bulletinType === '2' || remarks?.includes('국내영향없음'));
      const intensity = magnitude !== null
        ? Math.min(1450, Math.max(420, Math.round(magnitude * 240)))
        : 700;

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lon, lat],
        },
        properties: {
          id: `earthquake-${occurredAtRaw ?? announcedAtRaw ?? index + 1}`,
          layerKind: 'earthquake-ripple',
          name: locationLabel,
          locationLabel,
          magnitude,
          baseMagnitude: magnitude,
          intensity,
          depthKm,
          intensityLabel,
          occurredAt: formatDateTimeToken(occurredAtRaw),
          announcedAt: formatDateTimeToken(announcedAtRaw),
          occurredAtRaw,
          announcedAtRaw,
          stationId,
          bulletinType,
          bulletinSequence,
          referenceCount,
          remarks,
          corrections,
          imageUrl,
          affectsDomestic,
          severity: toSeverity(magnitude),
          source: 'upstream',
          sourceLabel: '기상청 지진정보 조회서비스',
          updatedAt,
        },
      };
    })
    .filter((feature): feature is EarthquakeFeature => feature !== null);

  return features.sort((left, right) => {
    const leftToken = String((left.properties as Record<string, unknown>).announcedAtRaw ?? '');
    const rightToken = String((right.properties as Record<string, unknown>).announcedAtRaw ?? '');
    return rightToken.localeCompare(leftToken);
  });
}

async function fetchEarthquakeData(args: {
  apiKey: string;
  upstreamUrl: string;
  period: EarthquakePeriod;
  pageNo: number;
  pageSize: number;
}): Promise<EarthquakeFetchResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('ServiceKey', args.apiKey);
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));
  url.searchParams.set('dataType', 'JSON');
  url.searchParams.set('fromTmFc', args.period.start);
  url.searchParams.set('toTmFc', args.period.end);

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
      totalCount: 0,
      resultCode: null,
      resultMsg: null,
      warning: `earthquake upstream responded ${response.status}`,
    };
  }

  const raw = await response.json() as unknown;
  const header = (
    isRecord(raw)
    && isRecord(raw.response)
    && isRecord(raw.response.header)
      ? raw.response.header
      : isRecord(raw) && isRecord(raw.header)
        ? raw.header
        : null
  );

  const resultCode = typeof header?.resultCode === 'string' ? header.resultCode.trim() : null;
  const resultMsg = typeof header?.resultMsg === 'string' ? header.resultMsg.trim() : null;

  if (resultCode && !SUCCESS_CODES.has(resultCode)) {
    return {
      rows: [],
      totalCount: 0,
      resultCode,
      resultMsg,
      warning: `earthquake API [${resultCode}] ${resultMsg ?? 'Unknown error'}`,
    };
  }

  return {
    rows: extractRowsFromCommonJson(raw),
    totalCount: extractTotalCountFromCommonJson(raw) ?? 0,
    resultCode,
    resultMsg,
  };
}

async function buildResult(args: {
  apiKey: string;
  upstreamUrl: string;
  period: EarthquakePeriod;
  pageNo: number;
  pageSize: number;
}): Promise<{ json: Record<string, unknown>; source: 'mock' | 'upstream' }> {
  const fetched = await fetchEarthquakeData(args);
  const updatedAt = new Date().toISOString();

  if (fetched.warning) {
    return {
      source: 'mock',
      json: {
        source: 'mock',
        updatedAt,
        period: args.period,
        totalCount: 0,
        data: emptyFeatureCollection(),
        warnings: [fetched.warning],
      },
    };
  }

  const features = buildEarthquakeFeatures(fetched.rows, updatedAt);

  return {
    source: 'upstream',
    json: {
      source: 'upstream',
      updatedAt,
      period: args.period,
      totalCount: fetched.totalCount,
      data: {
        type: 'FeatureCollection',
        features,
      },
      warnings:
        fetched.resultCode === '03'
          ? ['earthquake API returned NO_DATA for the selected period']
          : [],
    },
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceOnlyRaw = searchParams.get('sourceOnly');
  const sourceOnly = sourceOnlyRaw === '1' || sourceOnlyRaw === 'true' || sourceOnlyRaw === 'yes';

  const apiKey =
    process.env.TEAM2_DISASTER_EARTHQUAKE_API_KEY
    ?? process.env.TEAM2_DISASTER_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        period: resolvePeriod(searchParams),
        totalCount: 0,
        data: emptyFeatureCollection(),
        warnings: [
          'Missing env: TEAM2_DISASTER_EARTHQUAKE_API_KEY (or TEAM2_DISASTER_API_KEY / TEAM2_PUBLIC_API_KEY)',
        ],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  const period = resolvePeriod(searchParams);
  const pageNo = clampInt(toPositiveInt(searchParams.get('pageNo'), 1), 1, 10);
  const pageSize = clampInt(toPositiveInt(searchParams.get('numOfRows'), DEFAULT_PAGE_SIZE), MIN_PAGE_SIZE, MAX_PAGE_SIZE);
  const upstreamUrl = process.env.TEAM2_DISASTER_EARTHQUAKE_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;

  if (sourceOnly) {
    const fetched = await fetchEarthquakeData({
      apiKey,
      upstreamUrl,
      period,
      pageNo: 1,
      pageSize: 1,
    });

    const source: 'mock' | 'upstream' = fetched.warning ? 'mock' : 'upstream';
    const warnings = fetched.warning
      ? [fetched.warning]
      : fetched.resultCode === '03'
        ? ['earthquake API returned NO_DATA for the selected period']
        : [];

    return NextResponse.json(
      {
        source,
        updatedAt: new Date().toISOString(),
        period,
        totalCount: fetched.totalCount,
        warnings,
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': source } }
    );
  }

  const cacheKey = `${period.start}:${period.end}:${pageNo}:${pageSize}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.json, {
      headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': cached.source },
    });
  }

  const result = await buildResult({
    apiKey,
    upstreamUrl,
    period,
    pageNo,
    pageSize,
  });

  cache.set(cacheKey, {
    json: result.json,
    source: result.source,
    cachedAt: Date.now(),
  });

  return NextResponse.json(result.json, {
    headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': result.source },
  });
}
