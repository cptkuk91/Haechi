import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { compactText, toPositiveInt } from '@/app/api/_shared/parse-primitives';
import {
  fetchVWorldFeaturePage,
  type VWorldPageFetchResult,
} from '@/app/api/_shared/vworld-client';

const VWORLD_DATASET = 'LT_C_AISPRHC';
const DEFAULT_GEOM_FILTER = 'BOX(124,33,132,39)';
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGES = 20;

function compactNoFlyText(value: string): string {
  return compactText(value.replace(/<[^>]+>/g, ' '));
}

function sanitizeFeature(feature: GeoJSON.Feature, index: number): GeoJSON.Feature {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const prohibited = typeof properties.prohibited === 'string'
    ? compactNoFlyText(properties.prohibited)
    : properties.prohibited;

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
}): Promise<VWorldPageFetchResult> {
  return fetchVWorldFeaturePage({
    warningLabel: 'VWorld no-fly',
    dataset: VWORLD_DATASET,
    key: args.key,
    page: args.page,
    pageSize: args.pageSize,
    geomFilter: args.geomFilter,
    domain: args.domain,
    sanitizeFeature,
  });
}

export async function GET() {
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
