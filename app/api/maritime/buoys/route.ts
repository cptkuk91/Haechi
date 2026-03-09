import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
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
  clampMaritimeBuoyFeatureLimit,
  DEFAULT_MARITIME_BUOY_MAP_FEATURE_LIMIT,
  includesMaritimeBuoyCoordinate,
  parseMaritimeBuoyBbox,
} from '@/lib/maritime-buoys';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/1192136/Buoy/getBuoyInfo';
const DEFAULT_PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 10;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 20;

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

function parseBuoyCoordinate(raw: string | null, positiveSuffix: 'N' | 'E', negativeSuffix: 'S' | 'W'): number | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  const suffix = normalized.slice(-1);
  const numericPart = /[NSEW]$/.test(normalized) ? normalized.slice(0, -1) : normalized;
  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed)) return null;
  if (suffix === positiveSuffix || suffix === negativeSuffix) {
    return suffix === negativeSuffix ? -parsed : parsed;
  }
  return parsed;
}

function extractBuoyRowsFromXml(xml: string): JsonRecord[] {
  const items = extractXmlItems(xml, 'item');
  return items.map((itemXml) => ({
    blfrNo: extractXmlTagValue(itemXml, 'blfrNo', { decodeEntities: true, compactWhitespace: true }),
    buoyKr: extractXmlTagValue(itemXml, 'buoyKr', { decodeEntities: true, compactWhitespace: true }),
    buoyEn: extractXmlTagValue(itemXml, 'buoyEn', { decodeEntities: true, compactWhitespace: true }),
    buoyNm: extractXmlTagValue(itemXml, 'buoyNm', { decodeEntities: true, compactWhitespace: true }),
    seaNm: extractXmlTagValue(itemXml, 'seaNm', { decodeEntities: true, compactWhitespace: true }),
    lgtProperty: extractXmlTagValue(itemXml, 'lgt_property', { decodeEntities: true, compactWhitespace: true }),
    kindCd: extractXmlTagValue(itemXml, 'kindCd', { decodeEntities: true, compactWhitespace: true }),
    remark: extractXmlTagValue(itemXml, 'remark', { decodeEntities: true, compactWhitespace: true }),
    wgs84North: extractXmlTagValue(itemXml, 'wgs84North', { decodeEntities: true, compactWhitespace: true }),
    wgs84East: extractXmlTagValue(itemXml, 'wgs84East', { decodeEntities: true, compactWhitespace: true }),
  }));
}

async function fetchBuoyPage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
  pageSize: number;
  buoyType: string | null;
}): Promise<PageFetchResult> {
  const url = new URL(args.upstreamUrl);
  if (!url.searchParams.has('serviceKey') && !url.searchParams.has('ServiceKey')) {
    url.searchParams.set('serviceKey', args.apiKey);
  }
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));
  if (args.buoyType) {
    url.searchParams.set('buoyNm', args.buoyType);
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
      rows: [],
      totalCount: null,
      warning: `Buoy upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'Buoy upstream returned empty body',
    };
  }

  const warning = extractResultWarningFromXml(text, {
    sourceLabel: 'Buoy API',
    decodeEntities: true,
    compactWhitespace: true,
  }) ?? undefined;

  return {
    rows: extractBuoyRowsFromXml(text),
    totalCount: toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null,
    warning,
  };
}

function toBuoyFeatures(
  rows: JsonRecord[],
  bbox: ReturnType<typeof parseMaritimeBuoyBbox>
): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const dedupe = new Set<string>();

  for (const row of rows) {
    const lat = parseBuoyCoordinate(pickString(row, ['wgs84North']), 'N', 'S');
    const lng = parseBuoyCoordinate(pickString(row, ['wgs84East']), 'E', 'W');
    if (lat === null || lng === null) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;
    if (!includesMaritimeBuoyCoordinate(bbox, [lng, lat])) continue;

    const blfrNo = pickString(row, ['blfrNo']);
    const buoyKr = pickString(row, ['buoyKr']);
    const buoyEn = pickString(row, ['buoyEn']);
    const buoyType = pickString(row, ['buoyNm']);
    const seaName = pickString(row, ['seaNm']);
    const lightProperty = pickString(row, ['lgtProperty']);
    const kind = pickString(row, ['kindCd']);
    const remark = pickString(row, ['remark']);
    const featureId = blfrNo ?? `${lng.toFixed(6)}-${lat.toFixed(6)}`;

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
        layerKind: 'maritime-buoy',
        blfrNo,
        name: buoyKr ?? buoyEn ?? '항로표지',
        buoyKr,
        buoyEn,
        buoyType,
        seaName,
        lightProperty,
        kind,
        remark,
        wgs84North: pickString(row, ['wgs84North']),
        wgs84East: pickString(row, ['wgs84East']),
        source: 'khoa-buoy',
        sourceLabel: '해양수산부 항로표지 API',
      },
    });
  }

  return features;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const bbox = parseMaritimeBuoyBbox(requestUrl.searchParams.get('bbox'));
  const buoyType = requestUrl.searchParams.get('buoyType');
  const apiKey =
    process.env.TEAM2_MARITIME_BUOY_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_MARITIME_BUOY_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_PUBLIC_API_KEY / TEAM2_HEALTH_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_MARITIME_BUOY_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_MARITIME_BUOY_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_MARITIME_BUOY_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const featureLimit = clampMaritimeBuoyFeatureLimit(
    toPositiveInt(
      requestUrl.searchParams.get('limit'),
      toPositiveInt(process.env.TEAM2_MARITIME_BUOY_MAP_FEATURE_LIMIT, DEFAULT_MARITIME_BUOY_MAP_FEATURE_LIMIT)
    )
  );

  const warnings: string[] = [];
  const rows: JsonRecord[] = [];
  let totalPages = 1;

  for (let pageNo = 1; pageNo <= totalPages && pageNo <= maxPages; pageNo += 1) {
    const pageResult = await fetchBuoyPage({
      upstreamUrl,
      apiKey,
      pageNo,
      pageSize,
      buoyType,
    });
    if (pageResult.warning) warnings.push(pageResult.warning);
    rows.push(...pageResult.rows);

    if (pageResult.totalCount && pageResult.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(pageResult.totalCount / pageSize));
    } else if (pageResult.rows.length < pageSize) {
      break;
    }

    if (rows.length >= featureLimit * 2) {
      break;
    }
  }

  const features = toBuoyFeatures(rows, bbox).slice(0, featureLimit);
  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['Buoy upstream returned no coordinate features'],
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
        buoyType: buoyType ?? null,
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
