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
import { buildCircleRingMeters, closeSeatnRing } from '@/lib/maritime-seatn';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B551938/GisBaseHrbrFcltDtlInfoService/getGisBaseAnchrgDtlInfo';
const DEFAULT_PAGE_SIZE = 200;

interface AnchorageGroup {
  featureId: string;
  anchorageName: string;
  facilityCode: string;
  polygonRows: JsonRecord[];
  circleRow: JsonRecord | null;
  labelRow: JsonRecord | null;
  rawTypes: Set<string>;
}

function compareIndex(rowA: JsonRecord, rowB: JsonRecord): number {
  const a = pickNumber(rowA, ['indxNo']) ?? 0;
  const b = pickNumber(rowB, ['indxNo']) ?? 0;
  return a - b;
}

function buildPolygonCoordinates(rows: JsonRecord[]): [number, number][] {
  const coordinates: [number, number][] = [];
  let previousKey: string | null = null;

  for (const row of rows.toSorted(compareIndex)) {
    const lat = pickNumber(row, ['lat']);
    const lng = pickNumber(row, ['lot']);
    if (lat === null || lng === null) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;

    const key = `${lng.toFixed(6)},${lat.toFixed(6)}`;
    if (previousKey === key) continue;
    previousKey = key;
    coordinates.push([lng, lat]);
  }

  return coordinates;
}

function groupAnchorages(rows: JsonRecord[]): AnchorageGroup[] {
  const groups = new Map<string, AnchorageGroup>();

  for (const row of rows) {
    const anchorageName = pickString(row, ['anchrgNm']) ?? '정박지';
    const facilityCode = pickString(row, ['fcltCd']) ?? anchorageName;
    const featureId = `${facilityCode}-${anchorageName}`;
    const type = pickString(row, ['anchrgType']) ?? 'UNKNOWN';

    let group = groups.get(featureId);
    if (!group) {
      group = {
        featureId,
        anchorageName,
        facilityCode,
        polygonRows: [],
        circleRow: null,
        labelRow: null,
        rawTypes: new Set<string>(),
      };
      groups.set(featureId, group);
    }

    group.rawTypes.add(type);
    if (type === 'POLYGON') {
      group.polygonRows.push(row);
    } else if (type === 'CIRCLE' || type === 'BUNKER_RING') {
      group.circleRow = group.circleRow ?? row;
    } else if (type === 'TEXT') {
      group.labelRow = group.labelRow ?? row;
    }
  }

  return Array.from(groups.values());
}

function toAnchorageFeature(group: AnchorageGroup): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const polygonCoordinates = buildPolygonCoordinates(group.polygonRows);
  const circleRow = group.circleRow;
  let ring: [number, number][] = [];
  let geometryKind: 'polygon' | 'circle' = 'polygon';

  if (polygonCoordinates.length >= 3) {
    ring = closeSeatnRing(polygonCoordinates);
  } else if (circleRow) {
    const lat = pickNumber(circleRow, ['lat']);
    const lng = pickNumber(circleRow, ['lot']);
    const radiusMeters = pickNumber(circleRow, ['rad']);
    if (lat === null || lng === null || radiusMeters === null) return null;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
    ring = buildCircleRingMeters([lng, lat], radiusMeters);
    geometryKind = 'circle';
  } else {
    return null;
  }

  const representativeRow = circleRow ?? group.polygonRows[0] ?? group.labelRow;
  const labelRow = group.labelRow;
  const labelLat = pickNumber(labelRow ?? {}, ['lat']);
  const labelLng = pickNumber(labelRow ?? {}, ['lot']);
  const circleRadiusMeters = pickNumber(circleRow ?? {}, ['rad']);

  return {
    type: 'Feature',
    id: group.featureId,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
    properties: {
      id: group.featureId,
      layerKind: 'maritime-ulsan-anchorage',
      name: group.anchorageName,
      anchorageName: group.anchorageName,
      facilityCode: group.facilityCode,
      anchorageType: geometryKind === 'circle' ? pickString(circleRow ?? {}, ['anchrgType']) : 'POLYGON',
      geometryKind,
      geometryKindLabel: geometryKind === 'circle' ? '원형 정박지' : '다각형 정박지',
      pointCount: polygonCoordinates.length,
      radiusMeters: circleRadiusMeters,
      remark: pickString(representativeRow ?? {}, ['rmrk']),
      titleVisible: pickString(labelRow ?? {}, ['ttlYn']),
      labelLat,
      labelLng,
      rawTypes: Array.from(group.rawTypes),
      source: 'upa-anchorage',
      sourceLabel: '울산항 GIS 정박지 상세정보 API',
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

  const upstreamUrl = process.env.TEAM2_MARITIME_ULSAN_ANCHORAGE_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
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
        warnings: [`Ulsan anchorage upstream responded ${response.status}`],
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
  const resultWarning = extractResultWarningFromCommonJson(raw, 'Ulsan anchorage API');
  if (resultWarning) warnings.push(resultWarning);

  const rows = extractRowsFromCommonJson(raw);
  const totalCount = extractTotalCountFromCommonJson(raw);
  const groups = groupAnchorages(rows);
  const features = groups
    .map(toAnchorageFeature)
    .filter((feature): feature is GeoJSON.Feature<GeoJSON.Polygon> => Boolean(feature));

  const skippedCount = groups.length - features.length;
  if (skippedCount > 0) {
    warnings.push(`Skipped ${skippedCount} anchorage groups without drawable geometry`);
  }

  const typeCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const type = pickString(row, ['anchrgType']) ?? 'UNKNOWN';
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['Ulsan anchorage upstream returned no drawable geometry'],
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
        typeCounts,
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
