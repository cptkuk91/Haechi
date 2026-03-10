import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { clampInt, toPositiveInt, type JsonRecord } from '@/app/api/_shared/parse-primitives';
import {
  extractResultWarningFromXml,
  extractXmlItems,
  extractXmlTagValue,
} from '@/app/api/_shared/xml-utils';
import {
  buildSeatnCircleRing,
  closeSeatnRing,
  DEFAULT_MARITIME_SEATN_PAGE_SIZE,
  DEFAULT_MARITIME_SEATN_TNZONE,
  extractSeatnRadiusNm,
  parseSeatnCoordinatePair,
  parseSeatnDms,
  parseSeatnZoneCoordinates,
} from '@/lib/maritime-seatn';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/1192136/Seatn/getSeatnInfo';
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 300;

function extractSeatnRowsFromXml(xml: string): JsonRecord[] {
  return extractXmlItems(xml, 'item').map((itemXml) => ({
    posCd: extractXmlTagValue(itemXml, 'posCd', { decodeEntities: true, compactWhitespace: true }),
    centerZoneX: extractXmlTagValue(itemXml, 'centerZoneX', { decodeEntities: true, compactWhitespace: true }),
    centerZoneY: extractXmlTagValue(itemXml, 'centerZoneY', { decodeEntities: true, compactWhitespace: true }),
    crdnt: extractXmlTagValue(itemXml, 'crdnt', { decodeEntities: true, compactWhitespace: true }),
    hight: extractXmlTagValue(itemXml, 'hight', { decodeEntities: true, compactWhitespace: true }),
    mnctNm: extractXmlTagValue(itemXml, 'mnctNm', { decodeEntities: true, compactWhitespace: true }),
    mnctRef: extractXmlTagValue(itemXml, 'mnctRef', { decodeEntities: true, compactWhitespace: true }),
    mnctScaleRef: extractXmlTagValue(itemXml, 'mnctScaleRef', { decodeEntities: true, compactWhitespace: true }),
    origin: extractXmlTagValue(itemXml, 'origin', { decodeEntities: true, compactWhitespace: true }),
    oriorg: extractXmlTagValue(itemXml, 'oriorg', { decodeEntities: true, compactWhitespace: true }),
    oriyr: extractXmlTagValue(itemXml, 'oriyr', { decodeEntities: true, compactWhitespace: true }),
    relgoag: extractXmlTagValue(itemXml, 'relgoag', { decodeEntities: true, compactWhitespace: true })
      ?? extractXmlTagValue(itemXml, 'relgoad', { decodeEntities: true, compactWhitespace: true }),
    relregltn: extractXmlTagValue(itemXml, 'relregltn', { decodeEntities: true, compactWhitespace: true }),
    reviym: extractXmlTagValue(itemXml, 'reviym', { decodeEntities: true, compactWhitespace: true }),
    tnzone: extractXmlTagValue(itemXml, 'tnzone', { decodeEntities: true, compactWhitespace: true }),
    zoneCrdnt: extractXmlTagValue(itemXml, 'zoneCrdnt', { decodeEntities: true }),
    zoneDesc: extractXmlTagValue(itemXml, 'zoneDesc', { decodeEntities: true, compactWhitespace: true }),
  }));
}

async function fetchSeatnXml(args: {
  upstreamUrl: string;
  apiKey: string;
  tnzone: string;
  posCd: string | null;
  pageSize: number;
}): Promise<{ xml: string | null; warning?: string }> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('ServiceKey', args.apiKey);
  url.searchParams.set('tnzone', args.tnzone);
  url.searchParams.set('numOfRows', String(args.pageSize));
  url.searchParams.set('pageNo', '1');
  if (args.posCd) {
    url.searchParams.set('posCd', args.posCd);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      xml: null,
      warning: `Seatn upstream responded ${response.status}`,
    };
  }

  const xml = await response.text();
  if (!xml.trim()) {
    return {
      xml: null,
      warning: 'Seatn upstream returned empty body',
    };
  }

  return { xml };
}

function getSeatnCenter(row: JsonRecord, fallbackCoordinates: [number, number][]): [number, number] | null {
  const centerLat = parseSeatnDms(typeof row.centerZoneY === 'string' ? row.centerZoneY : null);
  const centerLng = parseSeatnDms(typeof row.centerZoneX === 'string' ? row.centerZoneX : null);
  if (centerLat !== null && centerLng !== null) {
    return [centerLng, centerLat];
  }

  const firstCoordinateRaw = typeof row.zoneCrdnt === 'string'
    ? row.zoneCrdnt.split(/\r?\n+/).map((value) => value.trim()).filter(Boolean)[0] ?? null
    : null;
  return firstCoordinateRaw ? parseSeatnCoordinatePair(firstCoordinateRaw) : fallbackCoordinates[0] ?? null;
}

function toSeatnFeature(row: JsonRecord, requestedTnzone: string): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const posCd = typeof row.posCd === 'string' ? row.posCd : null;
  if (!posCd) return null;

  const zoneDesc = typeof row.zoneDesc === 'string' ? row.zoneDesc : null;
  const zoneCoordinates = parseSeatnZoneCoordinates(typeof row.zoneCrdnt === 'string' ? row.zoneCrdnt : null);
  const radiusNm = extractSeatnRadiusNm(zoneDesc);
  const center = getSeatnCenter(row, zoneCoordinates);

  let ring: [number, number][] = [];
  let geometryKind: 'polygon' | 'radius' = 'polygon';

  if (radiusNm !== null && center) {
    ring = buildSeatnCircleRing(center, radiusNm);
    geometryKind = 'radius';
  } else if (zoneCoordinates.length >= 3) {
    ring = closeSeatnRing(zoneCoordinates);
  } else {
    return null;
  }

  return {
    type: 'Feature',
    id: posCd,
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
    properties: {
      id: posCd,
      layerKind: 'maritime-seatn',
      posCd,
      requestedTnzone,
      tnzone: typeof row.tnzone === 'string' ? row.tnzone : null,
      name: typeof row.crdnt === 'string' ? row.crdnt : posCd,
      locationLabel: typeof row.crdnt === 'string' ? row.crdnt : null,
      heightLimit: typeof row.hight === 'string' ? row.hight : null,
      chartName: typeof row.mnctNm === 'string' ? row.mnctNm : null,
      chartRef: typeof row.mnctRef === 'string' ? row.mnctRef : null,
      chartScale: typeof row.mnctScaleRef === 'string' ? row.mnctScaleRef : null,
      originName: typeof row.origin === 'string' ? row.origin : null,
      originOrg: typeof row.oriorg === 'string' ? row.oriorg : null,
      originYear: typeof row.oriyr === 'string' ? row.oriyr : null,
      relatedDept: typeof row.relgoag === 'string' ? row.relgoag : null,
      relatedRegulation: typeof row.relregltn === 'string' ? row.relregltn : null,
      revisedAt: typeof row.reviym === 'string' ? row.reviym : null,
      zoneDesc,
      geometryKind,
      geometryKindLabel: geometryKind === 'radius' ? '반경형 구역' : '다각형 구역',
      coordinateCount: zoneCoordinates.length,
      radiusNm,
      centerZoneX: typeof row.centerZoneX === 'string' ? row.centerZoneX : null,
      centerZoneY: typeof row.centerZoneY === 'string' ? row.centerZoneY : null,
      fillColor: geometryKind === 'radius' ? [245, 158, 11, 56] : [14, 165, 233, 48],
      lineColor: geometryKind === 'radius' ? [251, 191, 36, 188] : [56, 189, 248, 176],
      source: 'khoa-seatn',
      sourceLabel: '해양수산부 해상사격훈련구역 API',
    },
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tnzone = requestUrl.searchParams.get('tnzone') ?? process.env.TEAM2_MARITIME_SEATN_TNZONE ?? DEFAULT_MARITIME_SEATN_TNZONE;
  const posCd = requestUrl.searchParams.get('posCd');
  const pageSize = clampInt(
    toPositiveInt(requestUrl.searchParams.get('numOfRows'), DEFAULT_MARITIME_SEATN_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const apiKey =
    process.env.TEAM2_MARITIME_SEATN_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_MARITIME_SEATN_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_PUBLIC_API_KEY / TEAM2_HEALTH_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_MARITIME_SEATN_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const upstream = await fetchSeatnXml({
    upstreamUrl,
    apiKey,
    tnzone,
    posCd,
    pageSize,
  });

  const warnings = upstream.warning ? [upstream.warning] : [];
  if (!upstream.xml) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings,
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const resultWarning = extractResultWarningFromXml(upstream.xml, {
    sourceLabel: 'Seatn API',
    decodeEntities: true,
    compactWhitespace: true,
  });
  if (resultWarning) warnings.push(resultWarning);

  const rows = extractSeatnRowsFromXml(upstream.xml);
  const features = rows
    .map((row) => toSeatnFeature(row, tnzone))
    .filter((feature): feature is GeoJSON.Feature<GeoJSON.Polygon> => Boolean(feature));

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['Seatn upstream returned no mappable training zones'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const radiusCount = features.filter((feature) => feature.properties?.geometryKind === 'radius').length;

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
        tnzone,
        featureCount: features.length,
        radiusCount,
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
