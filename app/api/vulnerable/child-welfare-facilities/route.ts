import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { clampInt, compactText, toPositiveInt } from '@/app/api/_shared/parse-primitives';
import {
  fetchVWorldFeaturePage,
  type VWorldPageFetchResult,
} from '@/app/api/_shared/vworld-client';

const VWORLD_DATASET = 'LT_P_MGPRTFC';
const DEFAULT_GEOM_FILTER = 'BOX(124,33,132,39)';
const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES = 20;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const MIN_MAX_FEATURES = 1;
const ABSOLUTE_MAX_FEATURES = MAX_PAGES * MAX_PAGE_SIZE;
const DEFAULT_MAX_FEATURES = 1000;

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

function buildFallbackFeatureId(args: {
  name: string;
  address: string;
  feature: GeoJSON.Feature;
  index: number;
}): string {
  const normalizedName = (args.name || `child-welfare-${args.index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9\uac00-\ud7a3]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const normalizedAddress = (args.address || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9\uac00-\ud7a3]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (args.feature.geometry?.type === 'Point') {
    const [lng, lat] = args.feature.geometry.coordinates;
    if (typeof lng === 'number' && typeof lat === 'number') {
      return `vworld-child-welfare-${normalizedName}-${normalizedAddress}-${lng.toFixed(5)}-${lat.toFixed(5)}`;
    }
  }

  return `vworld-child-welfare-${normalizedName}-${normalizedAddress}-${args.index + 1}`;
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

  const categoryRaw = typeof properties.cat_nam === 'string' ? properties.cat_nam : '';
  const nameRaw = typeof properties.fac_nam === 'string' ? properties.fac_nam : '';
  const phoneRaw = typeof properties.fac_tel === 'string' ? properties.fac_tel : '';
  const oldAddressRaw = typeof properties.fac_o_add === 'string' ? properties.fac_o_add : '';
  const roadAddressRaw = typeof properties.fac_n_add === 'string' ? properties.fac_n_add : '';

  const category = compactText(categoryRaw) || '아동복지시설';
  const name = compactText(nameRaw) || `아동복지시설-${index + 1}`;
  const phone = compactText(phoneRaw);
  const oldAddress = compactText(oldAddressRaw);
  const roadAddress = compactText(roadAddressRaw);
  const address = roadAddress || oldAddress;

  const fallbackId = buildFallbackFeatureId({
    name,
    address,
    feature,
    index,
  });

  return {
    ...feature,
    id: feature.id ?? fallbackId,
    properties: {
      ...properties,
      name,
      category,
      facilityType: category,
      phone: phone || null,
      oldAddress: oldAddress || null,
      roadAddress: roadAddress || null,
      address: address || null,
      source: 'vworld',
      status: 'active',
    },
  };
}

async function fetchChildWelfarePage(args: {
  page: number;
  key: string;
  domain?: string;
  geomFilter: string;
  pageSize: number;
  attrFilter?: string;
}): Promise<VWorldPageFetchResult> {
  return fetchVWorldFeaturePage({
    warningLabel: 'VWorld child welfare',
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

async function collectFeatures(args: {
  key: string;
  domain?: string;
  geomFilter: string;
  pageSize: number;
  attrFilter?: string;
  maxFeatures: number;
  dedupeKeys: Set<string>;
  warnings: string[];
}): Promise<GeoJSON.Feature[]> {
  const collected: GeoJSON.Feature[] = [];
  let totalPages = 1;

  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page += 1) {
    const pageResult = await fetchChildWelfarePage({
      page,
      key: args.key,
      domain: args.domain,
      geomFilter: args.geomFilter,
      pageSize: args.pageSize,
      attrFilter: args.attrFilter,
    });

    if (pageResult.warning) {
      args.warnings.push(pageResult.warning);
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
  const searchParams = new URL(request.url).searchParams;
  const requestedBbox = parseBboxQueryParam(searchParams.get('bbox'));
  const geomFilter = requestedBbox
    ? bboxToGeomFilter(requestedBbox)
    : (process.env.TEAM2_SOCIAL_WELFARE_GEOM_FILTER ?? DEFAULT_GEOM_FILTER);
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_SOCIAL_WELFARE_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const attrFilter = process.env.TEAM2_SOCIAL_WELFARE_ATTR_FILTER;
  const defaultMaxFeatures = clampInt(
    toPositiveInt(process.env.TEAM2_SOCIAL_WELFARE_MAX_FEATURES, DEFAULT_MAX_FEATURES),
    MIN_MAX_FEATURES,
    ABSOLUTE_MAX_FEATURES
  );
  const requestMaxRaw = searchParams.get('max');
  const maxFeatures = clampInt(
    toPositiveInt(requestMaxRaw, defaultMaxFeatures),
    MIN_MAX_FEATURES,
    ABSOLUTE_MAX_FEATURES
  );

  const warnings: string[] = [];
  const dedupeKeys = new Set<string>();

  const features = await collectFeatures({
    key,
    domain,
    geomFilter,
    pageSize,
    attrFilter: attrFilter ?? undefined,
    maxFeatures,
    dedupeKeys,
    warnings,
  });

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['VWorld child welfare returned no features'],
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
