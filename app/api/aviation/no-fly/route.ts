import { NextResponse } from 'next/server';

const VWORLD_ENDPOINT = 'https://api.vworld.kr/req/data';
const VWORLD_DATASET = 'LT_C_AISPRHC';
const DEFAULT_GEOM_FILTER = 'BOX(124,33,132,39)';
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGES = 20;

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
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

function compactText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFeature(feature: GeoJSON.Feature, index: number): GeoJSON.Feature {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const prohibited = typeof properties.prohibited === 'string' ? compactText(properties.prohibited) : properties.prohibited;

  return {
    ...feature,
    id: feature.id ?? `vworld-no-fly-${index}`,
    properties: {
      ...properties,
      prohibited,
    },
  };
}

async function fetchNoFlyPage(args: {
  page: number;
  key: string;
  domain?: string;
  geomFilter: string;
  pageSize: number;
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

  if (args.domain) {
    url.searchParams.set('domain', args.domain);
  }

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
      warning: `VWorld no-fly upstream responded ${response.status}`,
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
      warning: `VWorld no-fly error [${code}] ${text}`,
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
      warning: 'VWorld no-fly response missing featureCollection',
    };
  }

  const totalPages = toPositiveInt(raw.response?.page?.total, 1);

  return {
    features: featureCollection.features.map((feature, index) => sanitizeFeature(feature, index)),
    totalPages,
  };
}

export async function GET() {
  const key = process.env.TEAM2_AVIATION_NO_FLY_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_AVIATION_NO_FLY_API_KEY'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const domain = process.env.TEAM2_AVIATION_NO_FLY_API_DOMAIN;
  const geomFilter = process.env.TEAM2_AVIATION_NO_FLY_GEOM_FILTER ?? DEFAULT_GEOM_FILTER;
  const pageSize = toPositiveInt(process.env.TEAM2_AVIATION_NO_FLY_PAGE_SIZE, DEFAULT_PAGE_SIZE);

  const warnings: string[] = [];
  const features: GeoJSON.Feature[] = [];

  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= MAX_PAGES; page += 1) {
    const pageResult = await fetchNoFlyPage({
      page,
      key,
      domain,
      geomFilter,
      pageSize,
    });

    if (pageResult.warning) {
      warnings.push(pageResult.warning);
      if (features.length === 0) break;
    }

    totalPages = pageResult.totalPages;
    features.push(...pageResult.features);
  }

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['VWorld no-fly returned no features'],
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
