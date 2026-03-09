import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  extractResultWarningFromXml,
  extractXmlItems,
  extractXmlTagValue,
} from '@/app/api/_shared/xml-utils';
import {
  DEFAULT_HEALTH_AED_MAP_FEATURE_LIMIT,
  includesHealthAedCoordinate,
  parseHealthAedBbox,
  clampHealthAedFeatureLimit,
} from '@/lib/health-aed';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552657/AEDInfoInqireService/getAedFullDown';
const DEFAULT_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 50;

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

function countCoordinateRows(rows: JsonRecord[]): number {
  return rows.reduce((count, row) => {
    const lng = pickNumber(row, ['wgs84Lon', 'longitude', 'lon', 'lng']);
    const lat = pickNumber(row, ['wgs84Lat', 'latitude', 'lat']);
    if (lng === null || lat === null) return count;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return count;
    return count + 1;
  }, 0);
}

function countCoordinateRowsInBbox(
  rows: JsonRecord[],
  bbox: ReturnType<typeof parseHealthAedBbox>
): number {
  return rows.reduce((count, row) => {
    const lng = pickNumber(row, ['wgs84Lon', 'longitude', 'lon', 'lng']);
    const lat = pickNumber(row, ['wgs84Lat', 'latitude', 'lat']);
    if (lng === null || lat === null) return count;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return count;
    return includesHealthAedCoordinate(bbox, [lng, lat]) ? count + 1 : count;
  }, 0);
}

function extractAedRowsFromXml(xml: string): JsonRecord[] {
  const matches = extractXmlItems(xml, 'item');
  const rows: JsonRecord[] = [];

  for (const itemXml of matches) {
    rows.push({
      buildAddress: extractXmlTagValue(itemXml, 'buildAddress', { decodeEntities: true, compactWhitespace: true }),
      buildPlace: extractXmlTagValue(itemXml, 'buildPlace', { decodeEntities: true, compactWhitespace: true }),
      gugun: extractXmlTagValue(itemXml, 'gugun', { decodeEntities: true, compactWhitespace: true }),
      manager: extractXmlTagValue(itemXml, 'manager', { decodeEntities: true, compactWhitespace: true }),
      managerTel: extractXmlTagValue(itemXml, 'managerTel', { decodeEntities: true, compactWhitespace: true }),
      mfg: extractXmlTagValue(itemXml, 'mfg', { decodeEntities: true, compactWhitespace: true }),
      model: extractXmlTagValue(itemXml, 'model', { decodeEntities: true, compactWhitespace: true }),
      org: extractXmlTagValue(itemXml, 'org', { decodeEntities: true, compactWhitespace: true }),
      sido: extractXmlTagValue(itemXml, 'sido', { decodeEntities: true, compactWhitespace: true }),
      wgs84Lon: extractXmlTagValue(itemXml, 'wgs84Lon'),
      wgs84Lat: extractXmlTagValue(itemXml, 'wgs84Lat'),
      zipcode1: extractXmlTagValue(itemXml, 'zipcode1'),
      zipcode2: extractXmlTagValue(itemXml, 'zipcode2'),
      clerkTel: extractXmlTagValue(itemXml, 'clerkTel', { decodeEntities: true, compactWhitespace: true }),
      serialNumber: extractXmlTagValue(itemXml, 'SERIAL_NUM', { decodeEntities: true, compactWhitespace: true }),
    });
  }

  return rows;
}

async function fetchAedPage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
  pageSize: number;
}): Promise<PageFetchResult> {
  const url = new URL(args.upstreamUrl);
  if (!url.searchParams.has('serviceKey')) {
    url.searchParams.set('serviceKey', args.apiKey);
  }
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      rows: [],
      totalCount: null,
      warning: `NMC AED upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'NMC AED upstream returned empty body',
    };
  }

  const warning = extractResultWarningFromXml(text, {
    sourceLabel: 'NMC AED API',
    decodeEntities: true,
    compactWhitespace: true,
  }) ?? undefined;

  return {
    rows: extractAedRowsFromXml(text),
    totalCount: toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null,
    warning,
  };
}

function buildAedAddress(row: JsonRecord): string | null {
  const parts = [
    pickString(row, ['sido']),
    pickString(row, ['gugun']),
    pickString(row, ['buildAddress']),
  ].filter((value, index, source) => Boolean(value) && source.indexOf(value) === index);

  if (parts.length === 0) return null;
  return parts.join(' ');
}

function toAedFeatures(
  rows: JsonRecord[],
  bbox: ReturnType<typeof parseHealthAedBbox>
): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const dedupe = new Set<string>();

  for (const row of rows) {
    const lng = pickNumber(row, ['wgs84Lon', 'longitude', 'lon', 'lng']);
    const lat = pickNumber(row, ['wgs84Lat', 'latitude', 'lat']);
    if (lng === null || lat === null) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;
    if (!includesHealthAedCoordinate(bbox, [lng, lat])) continue;

    const organization = pickString(row, ['org']);
    const installationPlace = pickString(row, ['buildPlace']);
    const address = buildAedAddress(row);
    const phone = pickString(row, ['clerkTel', 'managerTel']);
    const manager = pickString(row, ['manager']);
    const managerTel = pickString(row, ['managerTel']);
    const manufacturer = pickString(row, ['mfg']);
    const model = pickString(row, ['model']);
    const serialNumber = pickString(row, ['serialNumber']);
    const sido = pickString(row, ['sido']);
    const gugun = pickString(row, ['gugun']);
    const name = organization ?? installationPlace ?? 'AED';

    const featureId = serialNumber ?? `aed-${lng.toFixed(6)}-${lat.toFixed(6)}`;
    if (dedupe.has(featureId)) continue;
    dedupe.add(featureId);

    features.push({
      type: 'Feature',
      id: featureId,
      geometry: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      properties: {
        id: featureId,
        layerKind: 'aed',
        name,
        organization,
        installationPlace,
        address,
        phone,
        manager,
        managerTel,
        manufacturer,
        model,
        serialNumber,
        sido,
        gugun,
        source: 'nmc-aed',
        sourceLabel: 'NMC AED API',
      },
    });
  }

  return features;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const bbox = parseHealthAedBbox(requestUrl.searchParams.get('bbox'));
  const apiKey =
    process.env.TEAM2_HEALTH_AED_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_HEALTH_AED_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_HEALTH_API_KEY / TEAM2_PUBLIC_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_HEALTH_AED_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_AED_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_AED_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const featureLimit = clampHealthAedFeatureLimit(
    toPositiveInt(
      requestUrl.searchParams.get('limit'),
      toPositiveInt(process.env.TEAM2_HEALTH_AED_MAP_FEATURE_LIMIT, DEFAULT_HEALTH_AED_MAP_FEATURE_LIMIT)
    )
  );

  const warnings: string[] = [];
  const rows: JsonRecord[] = [];
  let coordinateRowCount = 0;

  let totalPages = 1;
  for (let pageNo = 1; pageNo <= totalPages && pageNo <= maxPages; pageNo += 1) {
    const pageResult = await fetchAedPage({
      upstreamUrl,
      apiKey,
      pageNo,
      pageSize,
    });

    if (pageResult.warning) warnings.push(pageResult.warning);
    rows.push(...pageResult.rows);
    coordinateRowCount += bbox
      ? countCoordinateRowsInBbox(pageResult.rows, bbox)
      : countCoordinateRows(pageResult.rows);

    if (pageResult.totalCount && pageResult.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(pageResult.totalCount / pageSize));
    } else if (pageResult.rows.length < pageSize) {
      break;
    }

    if (coordinateRowCount >= featureLimit) {
      warnings.push(`AED map display capped at ${featureLimit.toLocaleString('en-US')} coordinate features`);
      break;
    }
  }

  const features = toAedFeatures(rows, bbox).slice(0, featureLimit);
  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['AED upstream returned no coordinate features'],
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
        featureLimit,
        featureCount: features.length,
        bboxApplied: Boolean(bbox),
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
