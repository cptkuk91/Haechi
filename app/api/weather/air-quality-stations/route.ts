import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  clampWeatherAirStationFeatureLimit,
  DEFAULT_WEATHER_AIR_STATION_FEATURE_LIMIT,
  includesWeatherAirStationCoordinate,
  parseWeatherAirStationBbox,
  type WeatherAirStationBbox,
} from '@/lib/weather-air-quality-stations';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList';
const DEFAULT_PAGE_SIZE = 200;
const DATASET_CACHE_TTL_MS = 12 * 60 * 60_000;
const SUCCESS_CODES = new Set(['00', 'NORMAL_CODE']);

const REGION_QUERIES = [
  { query: '서울', prefixes: ['서울', '서울특별시'] },
  { query: '부산', prefixes: ['부산', '부산광역시'] },
  { query: '대구', prefixes: ['대구', '대구광역시'] },
  { query: '인천', prefixes: ['인천', '인천광역시'] },
  { query: '광주', prefixes: ['광주', '광주광역시'] },
  { query: '대전', prefixes: ['대전', '대전광역시'] },
  { query: '울산', prefixes: ['울산', '울산광역시'] },
  { query: '세종', prefixes: ['세종', '세종특별자치시'] },
  { query: '경기', prefixes: ['경기', '경기도'] },
  { query: '강원', prefixes: ['강원', '강원특별자치도'] },
  { query: '충북', prefixes: ['충북', '충청북도'] },
  { query: '충남', prefixes: ['충남', '충청남도'] },
  { query: '전북', prefixes: ['전북', '전북특별자치도'] },
  { query: '전남', prefixes: ['전남', '전라남도'] },
  { query: '경북', prefixes: ['경북', '경상북도'] },
  { query: '경남', prefixes: ['경남', '경상남도'] },
  { query: '제주', prefixes: ['제주', '제주특별자치도'] },
] as const;

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

interface AirStationDatasetCache {
  features: AirStationFeature[];
  totalCount: number;
  warnings: string[];
  fetchedAt: number;
}

type AirStationFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    id: string;
    layerKind: 'air-quality-station';
    name: string;
    stationName: string;
    address: string | null;
    monitoringNetwork: string | null;
    observationItems: string | null;
    installedYear: number | null;
    regionLabel: string | null;
    source: 'upstream';
    sourceLabel: string;
  }
>;

let datasetCache: AirStationDatasetCache | null = null;

async function fetchStationPage(args: {
  apiKey: string;
  upstreamUrl: string;
  addressQuery: string;
  pageNo: number;
  pageSize: number;
}): Promise<PageFetchResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('returnType', 'json');
  url.searchParams.set('numOfRows', String(args.pageSize));
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('addr', args.addressQuery);

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
      warning: `air station upstream responded ${response.status} for ${args.addressQuery}`,
    };
  }

  const raw = (await response.json()) as unknown;
  const warning = extractResultWarningFromCommonJson(raw, `air station API (${args.addressQuery})`, SUCCESS_CODES) ?? undefined;

  return {
    rows: extractRowsFromCommonJson(raw),
    totalCount: extractTotalCountFromCommonJson(raw),
    warning,
  };
}

function inferRegionLabel(address: string | null): string | null {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const token = normalized.split(/\s+/)[0];
  return token || null;
}

function rowToFeature(row: JsonRecord): AirStationFeature | null {
  const lat = pickNumber(row, ['dmX']);
  const lng = pickNumber(row, ['dmY']);
  if (lat === null || lng === null) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

  const stationName = pickString(row, ['stationName']) ?? '대기질 측정소';
  const address = pickString(row, ['addr']);
  const id = `${stationName}:${lng.toFixed(6)}:${lat.toFixed(6)}`;

  return {
    type: 'Feature',
    id,
    geometry: {
      type: 'Point',
      coordinates: [lng, lat],
    },
    properties: {
      id,
      layerKind: 'air-quality-station',
      name: stationName,
      stationName,
      address,
      monitoringNetwork: pickString(row, ['mangName']),
      observationItems: pickString(row, ['item']),
      installedYear: pickNumber(row, ['year']),
      regionLabel: inferRegionLabel(address),
      source: 'upstream',
      sourceLabel: '에어코리아 측정소정보',
    },
  };
}

function sortFeatures(features: AirStationFeature[]): AirStationFeature[] {
  return [...features].sort((left, right) => {
    const leftNetwork = left.properties.monitoringNetwork ?? '';
    const rightNetwork = right.properties.monitoringNetwork ?? '';
    const networkDiff = leftNetwork.localeCompare(rightNetwork, 'ko');
    if (networkDiff !== 0) return networkDiff;
    return left.properties.name.localeCompare(right.properties.name, 'ko');
  });
}

function filterRowsByRegionPrefix(rows: JsonRecord[], prefixes: readonly string[]): JsonRecord[] {
  return rows.filter((row) => {
    const address = pickString(row, ['addr']);
    if (!address) return false;
    return prefixes.some((prefix) => address.startsWith(prefix));
  });
}

async function loadDataset(args: {
  apiKey: string;
  upstreamUrl: string;
  pageSize: number;
}): Promise<AirStationDatasetCache> {
  const now = Date.now();
  if (datasetCache && now - datasetCache.fetchedAt < DATASET_CACHE_TTL_MS) {
    return datasetCache;
  }

  const warnings: string[] = [];
  const featureMap = new Map<string, AirStationFeature>();

  for (const region of REGION_QUERIES) {
    const firstPage = await fetchStationPage({
      apiKey: args.apiKey,
      upstreamUrl: args.upstreamUrl,
      addressQuery: region.query,
      pageNo: 1,
      pageSize: args.pageSize,
    });

    if (firstPage.warning) warnings.push(firstPage.warning);

    const totalCount = firstPage.totalCount ?? firstPage.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / args.pageSize));
    const pageRows = [...filterRowsByRegionPrefix(firstPage.rows, region.prefixes)];

    for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
      const page = await fetchStationPage({
        apiKey: args.apiKey,
        upstreamUrl: args.upstreamUrl,
        addressQuery: region.query,
        pageNo,
        pageSize: args.pageSize,
      });

      if (page.warning) warnings.push(page.warning);
      pageRows.push(...filterRowsByRegionPrefix(page.rows, region.prefixes));
    }

    for (const row of pageRows) {
      const feature = rowToFeature(row);
      if (!feature) continue;
      featureMap.set(String(feature.id), feature);
    }
  }

  const features = sortFeatures([...featureMap.values()]);
  const nextCache: AirStationDatasetCache = {
    features,
    totalCount: features.length,
    warnings: Array.from(new Set(warnings)),
    fetchedAt: now,
  };

  if (features.length > 0) {
    datasetCache = nextCache;
    return nextCache;
  }

  if (datasetCache) {
    return {
      ...datasetCache,
      warnings: Array.from(new Set([
        ...datasetCache.warnings,
        ...warnings,
        'Using stale air station cache after upstream refresh failure',
      ])),
    };
  }

  return nextCache;
}

function filterFeatures(args: {
  features: AirStationFeature[];
  bbox: WeatherAirStationBbox | null;
  limit: number;
}): AirStationFeature[] {
  const matched = args.features.filter((feature) =>
    includesWeatherAirStationCoordinate(args.bbox, feature.geometry.coordinates)
  );

  return matched.slice(0, args.limit);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const bbox = parseWeatherAirStationBbox(requestUrl.searchParams.get('bbox'));
  const featureLimit = clampWeatherAirStationFeatureLimit(
    toPositiveInt(requestUrl.searchParams.get('limit'), DEFAULT_WEATHER_AIR_STATION_FEATURE_LIMIT)
  );

  const apiKey =
    process.env.TEAM2_WEATHER_AIR_QUALITY_STATIONS_API_KEY
    ?? process.env.TEAM2_WEATHER_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        totalCount: 0,
        matchedCount: 0,
        data: emptyFeatureCollection(),
        warnings: [
          'Missing env: TEAM2_WEATHER_AIR_QUALITY_STATIONS_API_KEY (or TEAM2_WEATHER_API_KEY / TEAM2_PUBLIC_API_KEY)',
        ],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  const dataset = await loadDataset({
    apiKey,
    upstreamUrl: process.env.TEAM2_WEATHER_AIR_QUALITY_STATIONS_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const visibleFeatures = filterFeatures({
    features: dataset.features,
    bbox,
    limit: featureLimit,
  });

  const matchedCount = dataset.features.filter((feature) =>
    includesWeatherAirStationCoordinate(bbox, feature.geometry.coordinates)
  ).length;

  const source: 'mock' | 'upstream' = dataset.features.length > 0 ? 'upstream' : 'mock';

  return NextResponse.json(
    {
      source,
      updatedAt: new Date(dataset.fetchedAt).toISOString(),
      totalCount: dataset.totalCount,
      matchedCount,
      data: {
        type: 'FeatureCollection',
        features: visibleFeatures,
      },
      meta: {
        featureLimit,
        featureCount: visibleFeatures.length,
        bboxApplied: Boolean(bbox),
      },
      warnings: dataset.warnings,
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': source,
      },
    }
  );
}
