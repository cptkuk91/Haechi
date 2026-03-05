import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { clampInt, compactText, toPositiveInt } from '@/app/api/_shared/parse-primitives';
import {
  fetchVWorldFeaturePage,
  type VWorldPageFetchResult,
} from '@/app/api/_shared/vworld-client';

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
}): Promise<VWorldPageFetchResult> {
  return fetchVWorldFeaturePage({
    warningLabel: 'VWorld CCTV',
    dataset: VWORLD_DATASET,
    key: args.key,
    page: args.page,
    pageSize: args.pageSize,
    geomFilter: args.geomFilter,
    domain: args.domain,
    attrFilter: args.attrFilter,
    pointOnly: true,
    sanitizeFeature,
  });
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
