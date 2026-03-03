import { NextResponse } from 'next/server';

const VWORLD_ENDPOINT = 'https://api.vworld.kr/req/data';
const VWORLD_DATASET = 'LT_P_UTISCCTV';
const DEFAULT_GEOM_FILTER = 'BOX(124,33,132,39)';
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const MIN_MAX_FEATURES = 100;
const ABSOLUTE_MAX_FEATURES = MAX_PAGES * MAX_PAGE_SIZE;
const DEFAULT_MAX_FEATURES = 100;
const SEOUL_PRIORITY_ATTR_FILTER = 'locate:like:서울';
const SEOUL_COORDINATE: [number, number] = [126.978, 37.5665];

interface VWorldError {
  code?: string;
  text?: string;
}

interface VWorldResponsePayload {
  response?: {
    status?: string;
    page?: {
      total?: string | number;
      current?: string | number;
      size?: string | number;
    };
    result?: {
      featureCollection?: GeoJSON.FeatureCollection;
    };
    error?: VWorldError;
  };
}

interface PageFetchResult {
  features: GeoJSON.Feature[];
  totalPages: number;
  warning?: string;
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
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

function parseBboxQueryParam(raw: string | null): { west: number; south: number; east: number; north: number } | null {
  if (!raw) return null;
  const [westRaw, southRaw, eastRaw, northRaw] = raw.split(',');
  if (!westRaw || !southRaw || !eastRaw || !northRaw) return null;

  const west = Number(westRaw);
  const south = Number(southRaw);
  const east = Number(eastRaw);
  const north = Number(northRaw);

  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;

  return { west, south, east, north };
}

function bboxToGeomFilter(bbox: { west: number; south: number; east: number; north: number }): string {
  return `BOX(${bbox.west},${bbox.south},${bbox.east},${bbox.north})`;
}

function includesCoordinate(
  bbox: { west: number; south: number; east: number; north: number } | null,
  coord: [number, number]
): boolean {
  if (!bbox) return true;
  const [lng, lat] = coord;
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

function isValidPointFeature(feature: GeoJSON.Feature): boolean {
  if (!feature.geometry || feature.geometry.type !== 'Point') return false;
  const coords = feature.geometry.coordinates;
  return (
    Array.isArray(coords)
    && typeof coords[0] === 'number'
    && typeof coords[1] === 'number'
    && Number.isFinite(coords[0])
    && Number.isFinite(coords[1])
  );
}

function compactText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFallbackFeatureId(args: {
  name: string;
  locate: string;
  feature: GeoJSON.Feature;
  index: number;
}): string {
  const normalizedName = (args.name || `cctv-${args.index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const normalizedLocate = (args.locate || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (args.feature.geometry?.type === 'Point') {
    const [lng, lat] = args.feature.geometry.coordinates;
    if (typeof lng === 'number' && typeof lat === 'number') {
      return `vworld-cctv-${normalizedLocate}-${normalizedName}-${lng.toFixed(5)}-${lat.toFixed(5)}`;
    }
  }

  return `vworld-cctv-${normalizedLocate}-${normalizedName}-${args.index + 1}`;
}

function toFeatureKey(feature: GeoJSON.Feature): string {
  if (feature.id !== undefined && feature.id !== null) {
    return String(feature.id);
  }

  if (feature.geometry?.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates;
    if (typeof lng === 'number' && typeof lat === 'number') {
      return `point:${lng.toFixed(6)}:${lat.toFixed(6)}`;
    }
  }

  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const name = typeof properties.name === 'string' ? properties.name : 'unknown';
  return `fallback:${name}`;
}

function sanitizeFeature(feature: GeoJSON.Feature, index: number): GeoJSON.Feature {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const cctvNameRaw = typeof properties.cctvname === 'string' ? properties.cctvname : '';
  const locateRaw = typeof properties.locate === 'string' ? properties.locate : '';
  const cctvName = compactText(cctvNameRaw) || `CCTV-${index + 1}`;
  const locate = compactText(locateRaw);
  const fallbackId = buildFallbackFeatureId({ name: cctvName, locate, feature, index });

  return {
    ...feature,
    id: feature.id ?? fallbackId,
    properties: {
      ...properties,
      cctvname: cctvName,
      locate,
      name: cctvName,
      cctvType: 'traffic',
      status: 'active',
      streamUrl: null,
      source: 'vworld',
    },
  };
}

async function fetchCctvPage(args: {
  page: number;
  key: string;
  domain?: string;
  geomFilter: string;
  pageSize: number;
  attrFilter?: string;
}): Promise<PageFetchResult> {
  const url = new URL(VWORLD_ENDPOINT);
  url.searchParams.set('service', 'data');
  url.searchParams.set('version', '2.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('key', args.key);
  url.searchParams.set('format', 'json');
  url.searchParams.set('errorFormat', 'json');
  url.searchParams.set('size', String(args.pageSize));
  url.searchParams.set('page', String(args.page));
  url.searchParams.set('data', VWORLD_DATASET);
  url.searchParams.set('geomFilter', args.geomFilter);
  url.searchParams.set('geometry', 'true');
  url.searchParams.set('attribute', 'true');
  url.searchParams.set('crs', 'EPSG:4326');

  if (args.domain) url.searchParams.set('domain', args.domain);
  if (args.attrFilter) url.searchParams.set('attrFilter', args.attrFilter);

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return {
      features: [],
      totalPages: 1,
      warning: `VWorld CCTV upstream responded ${response.status}`,
    };
  }

  const raw = (await response.json()) as VWorldResponsePayload;
  const status = raw.response?.status ?? 'ERROR';
  if (status === 'ERROR') {
    const error = raw.response?.error;
    const code = error?.code ?? 'UNKNOWN_ERROR';
    const text = error?.text ?? 'VWorld API error';
    return {
      features: [],
      totalPages: 1,
      warning: `VWorld CCTV error [${code}] ${text}`,
    };
  }

  if (status === 'NOT_FOUND') {
    return {
      features: [],
      totalPages: 1,
    };
  }

  const featureCollection = raw.response?.result?.featureCollection;
  if (!isFeatureCollection(featureCollection)) {
    return {
      features: [],
      totalPages: 1,
      warning: 'VWorld CCTV response missing featureCollection',
    };
  }

  const totalPages = toPositiveInt(raw.response?.page?.total, 1);
  const features = featureCollection.features
    .filter((feature): feature is GeoJSON.Feature => isValidPointFeature(feature))
    .map((feature, index) => sanitizeFeature(feature, index));

  return {
    features,
    totalPages,
  };
}

async function collectCctvFeatures(args: {
  key: string;
  domain?: string;
  geomFilter: string;
  pageSize: number;
  attrFilter?: string;
  maxFeatures: number;
  dedupeKeys: Set<string>;
  warnings: string[];
  warningScope?: string;
}): Promise<GeoJSON.Feature[]> {
  const collected: GeoJSON.Feature[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page += 1) {
    const pageResult = await fetchCctvPage({
      page,
      key: args.key,
      domain: args.domain,
      geomFilter: args.geomFilter,
      pageSize: args.pageSize,
      attrFilter: args.attrFilter,
    });

    if (pageResult.warning) {
      const scope = args.warningScope ? `[${args.warningScope}] ` : '';
      args.warnings.push(`${scope}${pageResult.warning}`);
      if (collected.length === 0) break;
    }

    totalPages = pageResult.totalPages;

    for (const feature of pageResult.features) {
      const dedupeKey = toFeatureKey(feature);
      if (args.dedupeKeys.has(dedupeKey)) continue;
      args.dedupeKeys.add(dedupeKey);

      collected.push(feature);
      if (collected.length >= args.maxFeatures) return collected;
    }
  }

  return collected;
}

export async function GET(request: Request) {
  const key = process.env.TEAM2_DIGITAL_TWIN_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_DIGITAL_TWIN_API_KEY'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const domain = process.env.TEAM2_DIGITAL_TWIN_API_DOMAIN;
  const requestedBbox = parseBboxQueryParam(new URL(request.url).searchParams.get('bbox'));
  const geomFilter = requestedBbox
    ? bboxToGeomFilter(requestedBbox)
    : (process.env.TEAM2_CCTV_GEOM_FILTER ?? DEFAULT_GEOM_FILTER);
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_CCTV_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const attrFilter = process.env.TEAM2_CCTV_ATTR_FILTER;
  const defaultMaxFeatures = clampInt(
    toPositiveInt(process.env.TEAM2_CCTV_MAX_FEATURES, DEFAULT_MAX_FEATURES),
    MIN_MAX_FEATURES,
    ABSOLUTE_MAX_FEATURES
  );
  const requestMaxRaw = new URL(request.url).searchParams.get('max');
  const maxFeatures = clampInt(
    toPositiveInt(requestMaxRaw, defaultMaxFeatures),
    MIN_MAX_FEATURES,
    ABSOLUTE_MAX_FEATURES
  );

  const warnings: string[] = [];
  const dedupeKeys = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  const seoulPriorityEnabled = !attrFilter && includesCoordinate(requestedBbox, SEOUL_COORDINATE);

  if (seoulPriorityEnabled) {
    const seoulFirstFeatures = await collectCctvFeatures({
      key,
      domain,
      geomFilter,
      pageSize,
      attrFilter: SEOUL_PRIORITY_ATTR_FILTER,
      maxFeatures,
      dedupeKeys,
      warnings,
      warningScope: 'seoul-priority',
    });
    features.push(...seoulFirstFeatures);
  }

  if (features.length < maxFeatures) {
    const nationwideFillFeatures = await collectCctvFeatures({
      key,
      domain,
      geomFilter,
      pageSize,
      attrFilter,
      maxFeatures: maxFeatures - features.length,
      dedupeKeys,
      warnings,
      warningScope: seoulPriorityEnabled ? 'nationwide-fill' : undefined,
    });
    features.push(...nationwideFillFeatures);
  }

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['VWorld CCTV returned no features'],
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
