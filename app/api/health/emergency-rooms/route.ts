import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
  compactText,
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import { extractXmlItems, extractXmlTagValue } from '@/app/api/_shared/xml-utils';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getEgytListInfoInqire';
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

function extractRowsFromXml(xml: string): JsonRecord[] {
  const matches = extractXmlItems(xml, 'item');
  const rows: JsonRecord[] = [];
  for (const itemXml of matches) {
    rows.push({
      hpid: extractXmlTagValue(itemXml, 'hpid'),
      dutyName: extractXmlTagValue(itemXml, 'dutyName'),
      dutyEmclsName: extractXmlTagValue(itemXml, 'dutyEmclsName'),
      dutyAddr: extractXmlTagValue(itemXml, 'dutyAddr'),
      dutyTel3: extractXmlTagValue(itemXml, 'dutyTel3'),
      dutyTel1: extractXmlTagValue(itemXml, 'dutyTel1'),
      wgs84Lon: extractXmlTagValue(itemXml, 'wgs84Lon'),
      wgs84Lat: extractXmlTagValue(itemXml, 'wgs84Lat'),
    });
  }
  return rows;
}

async function fetchEmergencyRoomPage(args: {
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
  url.searchParams.set('_type', 'json');
  url.searchParams.set('resultType', 'json');

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      rows: [],
      totalCount: null,
      warning: `NMC emergency upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'NMC emergency upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    const warning = extractResultWarningFromCommonJson(json, 'NMC emergency API') ?? undefined;
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json),
      warning,
    };
  } catch {
    const rows = extractRowsFromXml(text);
    const totalCount = toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null;
    return {
      rows,
      totalCount,
    };
  }
}

function toEmergencyRoomFeatures(rows: JsonRecord[]): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const dedupe = new Set<string>();

  for (const row of rows) {
    const lng = pickNumber(row, ['wgs84Lon', 'wgs84lon', 'longitude', 'lon', 'lng', 'mapX', 'xPos', 'x']);
    const lat = pickNumber(row, ['wgs84Lat', 'wgs84lat', 'latitude', 'lat', 'mapY', 'yPos', 'y']);
    if (lng === null || lat === null) continue;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) continue;

    const hpid = pickString(row, ['hpid', 'HPID', 'id']);
    const name = pickString(row, ['dutyName', 'name', 'hospitalName']) ?? '응급의료기관';
    const institutionType = pickString(row, ['dutyEmclsName', 'institutionType']) ?? '응급의료기관';
    const address = pickString(row, ['dutyAddr', 'address']);
    const phone = pickString(row, ['dutyTel3', 'dutyTel1', 'phone']);

    const featureId = hpid ?? `er-${lng.toFixed(6)}-${lat.toFixed(6)}`;
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
        hpid,
        name,
        institutionType,
        address,
        phone,
        source: 'nmc',
      },
    });
  }

  return features;
}

export async function GET() {
  const apiKey = process.env.TEAM2_HEALTH_API_KEY ?? process.env.TEAM2_PUBLIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_HEALTH_API_KEY (or TEAM2_PUBLIC_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_HEALTH_EMERGENCY_ROOMS_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_EMERGENCY_ROOMS_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_EMERGENCY_ROOMS_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );

  const warnings: string[] = [];
  const rows: JsonRecord[] = [];

  let totalPages = 1;
  for (let pageNo = 1; pageNo <= totalPages && pageNo <= maxPages; pageNo += 1) {
    const pageResult = await fetchEmergencyRoomPage({
      upstreamUrl,
      apiKey,
      pageNo,
      pageSize,
    });

    if (pageResult.warning) warnings.push(pageResult.warning);
    rows.push(...pageResult.rows);

    if (pageResult.totalCount && pageResult.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(pageResult.totalCount / pageSize));
    } else if (pageResult.rows.length < pageSize) {
      break;
    }
  }

  const features = toEmergencyRoomFeatures(rows);
  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['Emergency room upstream returned no coordinate features'],
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
