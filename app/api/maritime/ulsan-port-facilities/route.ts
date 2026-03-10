import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B551938/GisBaseHrbrFcltDtlInfoService/getGisBaseHrbrFcltDtlInfo';
const DEFAULT_PAGE_SIZE = 100;

function toPortFacilityFeature(row: JsonRecord): GeoJSON.Feature<GeoJSON.Point> | null {
  const lat = pickNumber(row, ['lat']);
  const lng = pickNumber(row, ['lot']);
  if (lat === null || lng === null) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

  const facilityCode = pickString(row, ['fcltCd']);
  const facilitySubCode = pickString(row, ['fcltSubCd']);
  const wharfName = pickString(row, ['whrfNm']);
  const featureId = [facilityCode, facilitySubCode, wharfName].filter(Boolean).join('-') || `${lng.toFixed(6)}-${lat.toFixed(6)}`;

  return {
    type: 'Feature',
    id: featureId,
    geometry: {
      type: 'Point',
      coordinates: [lng, lat],
    },
    properties: {
      id: featureId,
      layerKind: 'maritime-ulsan-port-facility',
      name: wharfName ?? facilityCode ?? '울산항 항만시설',
      portName: pickString(row, ['prtNm']),
      portAreaCode: pickString(row, ['prtagCd']),
      wharfName,
      facilityCode,
      facilitySubCode,
      length: pickString(row, ['len']),
      depthOfWater: pickString(row, ['dow']),
      berthCapacity: pickString(row, ['brthdCapVl']),
      berthVesselCount: pickString(row, ['brthdVslCntVl']),
      unloadCapacity: pickString(row, ['unloadCapVl']),
      cargoName: pickString(row, ['hndlCrgNm']),
      wharfCategory: pickString(row, ['whrfSeNm']),
      operatorName: pickString(row, ['ptopNm']),
      source: 'upa-port-facility',
      sourceLabel: '울산항 GIS 항만시설 상세정보 API',
    },
  };
}

export async function GET() {
  const apiKey =
    process.env.TEAM2_MARITIME_ULSAN_PORT_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_MARITIME_ULSAN_PORT_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_PUBLIC_API_KEY / TEAM2_HEALTH_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_MARITIME_ULSAN_PORT_FACILITY_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const url = new URL(upstreamUrl);
  url.searchParams.set('serviceKey', apiKey);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', String(DEFAULT_PAGE_SIZE));
  url.searchParams.set('resultType', 'json');

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: [`Ulsan port facility upstream responded ${response.status}`],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const raw = (await response.json()) as unknown;
  const warnings: string[] = [];
  const resultWarning = extractResultWarningFromCommonJson(raw, 'Ulsan port facility API');
  if (resultWarning) warnings.push(resultWarning);

  const rows = extractRowsFromCommonJson(raw);
  const totalCount = extractTotalCountFromCommonJson(raw);
  const features = rows
    .map(toPortFacilityFeature)
    .filter((feature): feature is GeoJSON.Feature<GeoJSON.Point> => Boolean(feature));

  const missingCoordinateCount = rows.length - features.length;
  if (missingCoordinateCount > 0) {
    warnings.push(`Skipped ${missingCoordinateCount} facilities without coordinates`);
  }

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['Ulsan port facility upstream returned no coordinate features'],
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
        totalCount,
        featureCount: features.length,
        missingCoordinateCount,
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
