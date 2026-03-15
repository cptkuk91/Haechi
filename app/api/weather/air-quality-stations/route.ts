import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { toPositiveInt } from '@/app/api/_shared/parse-primitives';
import {
  loadAirStationDataset,
  type AirStationFeature,
  DEFAULT_AIR_STATION_DATASET_PAGE_SIZE,
} from '@/app/api/weather/_shared/air-quality-stations-dataset';
import {
  clampWeatherAirStationFeatureLimit,
  DEFAULT_WEATHER_AIR_STATION_FEATURE_LIMIT,
  includesWeatherAirStationCoordinate,
  parseWeatherAirStationBbox,
  type WeatherAirStationBbox,
} from '@/lib/weather-air-quality-stations';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList';

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

  const dataset = await loadAirStationDataset({
    apiKey,
    upstreamUrl: process.env.TEAM2_WEATHER_AIR_QUALITY_STATIONS_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL,
    pageSize: DEFAULT_AIR_STATION_DATASET_PAGE_SIZE,
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
