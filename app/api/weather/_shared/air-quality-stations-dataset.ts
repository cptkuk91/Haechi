import {
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';

export const DEFAULT_AIR_STATION_DATASET_PAGE_SIZE = 200;
export const DEFAULT_AIR_STATION_DATASET_CACHE_TTL_MS = 12 * 60 * 60_000;
const SUCCESS_CODES = new Set(['00', 'NORMAL_CODE']);

export const AIR_STATION_REGION_QUERIES = [
  { regionCode: '서울', query: '서울', prefixes: ['서울', '서울특별시'] },
  { regionCode: '부산', query: '부산', prefixes: ['부산', '부산광역시'] },
  { regionCode: '대구', query: '대구', prefixes: ['대구', '대구광역시'] },
  { regionCode: '인천', query: '인천', prefixes: ['인천', '인천광역시'] },
  { regionCode: '광주', query: '광주', prefixes: ['광주', '광주광역시'] },
  { regionCode: '대전', query: '대전', prefixes: ['대전', '대전광역시'] },
  { regionCode: '울산', query: '울산', prefixes: ['울산', '울산광역시'] },
  { regionCode: '세종', query: '세종', prefixes: ['세종', '세종특별자치시'] },
  { regionCode: '경기', query: '경기', prefixes: ['경기', '경기도'] },
  { regionCode: '강원', query: '강원', prefixes: ['강원', '강원특별자치도'] },
  { regionCode: '충북', query: '충북', prefixes: ['충북', '충청북도'] },
  { regionCode: '충남', query: '충남', prefixes: ['충남', '충청남도'] },
  { regionCode: '전북', query: '전북', prefixes: ['전북', '전북특별자치도'] },
  { regionCode: '전남', query: '전남', prefixes: ['전남', '전라남도'] },
  { regionCode: '경북', query: '경북', prefixes: ['경북', '경상북도'] },
  { regionCode: '경남', query: '경남', prefixes: ['경남', '경상남도'] },
  { regionCode: '제주', query: '제주', prefixes: ['제주', '제주특별자치도'] },
] as const;

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

export interface AirStationDatasetCache {
  features: AirStationFeature[];
  totalCount: number;
  warnings: string[];
  fetchedAt: number;
}

export type AirStationFeature = GeoJSON.Feature<
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
    regionCode: string | null;
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

function rowToFeature(row: JsonRecord, regionCode: string): AirStationFeature | null {
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
      regionCode,
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

export async function loadAirStationDataset(args: {
  apiKey: string;
  upstreamUrl: string;
  pageSize?: number;
  cacheTtlMs?: number;
}): Promise<AirStationDatasetCache> {
  const pageSize = args.pageSize ?? DEFAULT_AIR_STATION_DATASET_PAGE_SIZE;
  const cacheTtlMs = args.cacheTtlMs ?? DEFAULT_AIR_STATION_DATASET_CACHE_TTL_MS;
  const now = Date.now();

  if (datasetCache && now - datasetCache.fetchedAt < cacheTtlMs) {
    return datasetCache;
  }

  const warnings: string[] = [];
  const featureMap = new Map<string, AirStationFeature>();

  for (const region of AIR_STATION_REGION_QUERIES) {
    const firstPage = await fetchStationPage({
      apiKey: args.apiKey,
      upstreamUrl: args.upstreamUrl,
      addressQuery: region.query,
      pageNo: 1,
      pageSize,
    });

    if (firstPage.warning) warnings.push(firstPage.warning);

    const totalCount = firstPage.totalCount ?? firstPage.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const pageRows = [...filterRowsByRegionPrefix(firstPage.rows, region.prefixes)];

    for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
      const page = await fetchStationPage({
        apiKey: args.apiKey,
        upstreamUrl: args.upstreamUrl,
        addressQuery: region.query,
        pageNo,
        pageSize,
      });

      if (page.warning) warnings.push(page.warning);
      pageRows.push(...filterRowsByRegionPrefix(page.rows, region.prefixes));
    }

    for (const row of pageRows) {
      const feature = rowToFeature(row, region.regionCode);
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
