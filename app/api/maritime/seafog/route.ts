import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  pickNumber,
  pickString,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  formatMaritimeSeafogDistance,
  getMaritimeSeafogRiskLabel,
  MARITIME_SEAFOG_STATIONS,
} from '@/lib/maritime-seafog';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/1192136/surveySeafog/GetSurveySeafogApiService';

interface StationFetchResult {
  stationCode: string;
  stationName: string;
  row: JsonRecord | null;
  warning?: string;
}

async function fetchSeaFogStation(args: {
  upstreamUrl: string;
  apiKey: string;
  stationCode: string;
  stationName: string;
}): Promise<StationFetchResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('type', 'json');
  url.searchParams.set('obsCode', args.stationCode);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', '1');

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      stationCode: args.stationCode,
      stationName: args.stationName,
      row: null,
      warning: `Sea fog upstream responded ${response.status} for ${args.stationCode}`,
    };
  }

  const raw = (await response.json()) as unknown;
  const warning = extractResultWarningFromCommonJson(raw, `Sea fog API ${args.stationCode}`) ?? undefined;
  const rows = extractRowsFromCommonJson(raw);

  return {
    stationCode: args.stationCode,
    stationName: args.stationName,
    row: rows[0] ?? null,
    warning: rows.length === 0 ? warning ?? `Sea fog API returned no rows for ${args.stationCode}` : warning,
  };
}

function toSeaFogFeature(result: StationFetchResult): GeoJSON.Feature<GeoJSON.Point> | null {
  if (!result.row) return null;

  const lat = pickNumber(result.row, ['lat', 'latitude']);
  const lng = pickNumber(result.row, ['lot', 'lng', 'lon', 'longitude']);
  if (lat === null || lng === null) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

  const visibilityMeters = pickNumber(result.row, ['dtvsbM20kLen']);
  const verticalVisibilityMeters = pickNumber(result.row, ['dtvsbV20kLen']);
  const windSpeed = pickNumber(result.row, ['rmyWspd']);
  const humidityPct = pickNumber(result.row, ['amonAvgHum']);
  const pressureHpa = pickNumber(result.row, ['amonAvgAtmpr']);
  const airTemperatureC = pickNumber(result.row, ['amonAvgTp']);
  const waterTemperatureC = pickNumber(result.row, ['amonAvgWtem']);
  const observedAt = pickString(result.row, ['obsrvnDt']);
  const windDirection = pickString(result.row, ['rmyWndrct']);
  const visibilityLabel = formatMaritimeSeafogDistance(visibilityMeters);
  const verticalVisibilityLabel = formatMaritimeSeafogDistance(verticalVisibilityMeters);
  const fogRiskLabel = getMaritimeSeafogRiskLabel(visibilityMeters);

  return {
    type: 'Feature',
    id: result.stationCode,
    geometry: {
      type: 'Point',
      coordinates: [lng, lat],
    },
    properties: {
      id: result.stationCode,
      layerKind: 'maritime-seafog',
      obsCode: result.stationCode,
      name: pickString(result.row, ['obsvtrNm']) ?? result.stationName,
      observedAt,
      visibilityMeters,
      visibilityLabel,
      verticalVisibilityMeters,
      verticalVisibilityLabel,
      windSpeed,
      windDirection,
      humidityPct,
      pressureHpa,
      airTemperatureC,
      waterTemperatureC,
      fogRiskLabel,
      source: 'khoa-seafog',
      sourceLabel: '해양수산부 해무관측소 API',
    },
  };
}

export async function GET() {
  const apiKey =
    process.env.TEAM2_MARITIME_SEAFOG_API_KEY
    ?? process.env.TEAM2_MARITIME_BUOY_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_MARITIME_SEAFOG_API_KEY (or TEAM2_MARITIME_BUOY_API_KEY / TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_PUBLIC_API_KEY / TEAM2_HEALTH_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_MARITIME_SEAFOG_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;

  const stationResults = await Promise.all(
    MARITIME_SEAFOG_STATIONS.map((station) =>
      fetchSeaFogStation({
        upstreamUrl,
        apiKey,
        stationCode: station.code,
        stationName: station.name,
      })
    )
  );

  const warnings = stationResults.flatMap((result) => (result.warning ? [result.warning] : []));
  const features = stationResults
    .map(toSeaFogFeature)
    .filter((feature): feature is GeoJSON.Feature<GeoJSON.Point> => Boolean(feature));

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['Sea fog upstream returned no coordinate features'],
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
      meta: {
        stationCount: MARITIME_SEAFOG_STATIONS.length,
        featureCount: features.length,
      },
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': 'upstream',
      },
    }
  );
}
