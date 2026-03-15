import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/1741000/civil_defense_shelter_info/info';
const PAGE_SIZE = 100;
const DEFAULT_FEATURE_LIMIT = 500;
const MIN_FEATURE_LIMIT = 1;
const MAX_FEATURE_LIMIT = 5_000;
const DEFAULT_MAX_PAGES = 200;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 300;
const RESPONSE_CACHE_TTL_MS = 30 * 60 * 1000;
const SUCCESS_CODES = new Set(['0', '00', 'NORMAL_SERVICE']);
const FETCH_BATCH_SIZE = 12;
const MIN_CANDIDATE_TARGET = 200;
const MAX_CANDIDATE_TARGET = 4_000;

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

interface CachedResponse {
  json: Record<string, unknown>;
  source: 'mock' | 'upstream';
  cachedAt: number;
}

type ShelterFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    id: string;
    layerKind: 'civil-defense-shelter';
    name: string;
    managementNo: string | null;
    facilityType: string | null;
    operationStatus: string | null;
    locationType: string | null;
    facilityArea: number | null;
    capacity: number | null;
    roadAddress: string | null;
    lotAddress: string | null;
    postalCode: string | null;
    designatedAt: string | null;
    removedAt: string | null;
    updatedAt: string | null;
    lastModifiedAt: string | null;
    updateType: string | null;
    localAgencyCode: string | null;
    coordX5179: number | null;
    coordY5179: number | null;
    source: 'upstream';
    sourceLabel: string;
  }
>;

const responseCache = new Map<string, CachedResponse>();

function parseBboxQueryParam(raw: string | null): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;

  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;

  return { west, south, east, north };
}

function includesCoordinate(bbox: Bbox | null, coordinate: GeoJSON.Position): boolean {
  if (!bbox) return true;
  const [lng, lat] = coordinate;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

function clampFeatureLimit(raw: unknown): number {
  return clampInt(toPositiveInt(raw, DEFAULT_FEATURE_LIMIT), MIN_FEATURE_LIMIT, MAX_FEATURE_LIMIT);
}

function buildCandidateTarget(featureLimit: number, hasBbox: boolean): number {
  const multiplier = hasBbox ? 3 : 2;
  return clampInt(featureLimit * multiplier, MIN_CANDIDATE_TARGET, MAX_CANDIDATE_TARGET);
}

function toIsoDateTime(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function fetchShelterPage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
}): Promise<PageFetchResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(PAGE_SIZE));
  url.searchParams.set('returnType', 'json');

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
      warning: `civil defense shelter upstream responded ${response.status}`,
    };
  }

  const raw = (await response.json()) as unknown;
  const warning = extractResultWarningFromCommonJson(raw, 'civil defense shelter API', SUCCESS_CODES) ?? undefined;

  return {
    rows: extractRowsFromCommonJson(raw),
    totalCount: extractTotalCountFromCommonJson(raw),
    warning,
  };
}

function rowToShelterFeature(row: JsonRecord): ShelterFeature | null {
  const lng = pickNumber(row, ['LOT_EPST4326', 'LOT_EPSG4326', 'lon']);
  const lat = pickNumber(row, ['LAT_EPSG4326', 'lat']);
  if (lng === null || lat === null) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

  const managementNo = pickString(row, ['MNG_NO']);
  const name = pickString(row, ['FCLT_NM']) ?? '민방위 대피시설';

  return {
    type: 'Feature',
    id: managementNo ?? `${lng.toFixed(6)}-${lat.toFixed(6)}`,
    geometry: {
      type: 'Point',
      coordinates: [lng, lat],
    },
    properties: {
      id: managementNo ?? `${lng.toFixed(6)}-${lat.toFixed(6)}`,
      layerKind: 'civil-defense-shelter',
      name,
      managementNo,
      facilityType: pickString(row, ['FCLT_SE']),
      operationStatus: pickString(row, ['OPER_STTS']),
      locationType: pickString(row, ['FCLTLOC_GRND_UDGD']),
      facilityArea: pickNumber(row, ['FCLT_AREA']),
      capacity: pickNumber(row, ['MAX_ACTC_PERNE']),
      roadAddress: pickString(row, ['ROAD_NM_WHOL_ADDR']),
      lotAddress: pickString(row, ['LCTN_WHOL_ADDR']),
      postalCode: pickString(row, ['ROAD_NM_ZIP']),
      designatedAt: pickString(row, ['DSGN_YMD']),
      removedAt: pickString(row, ['RMV_YMD']),
      updatedAt: toIsoDateTime(pickString(row, ['DAT_UPDT_PNT'])),
      lastModifiedAt: toIsoDateTime(pickString(row, ['LAST_MDFCN_PNT'])),
      updateType: pickString(row, ['DAT_UPDT_SE']),
      localAgencyCode: pickString(row, ['OPN_ATMY_GRP_CD']),
      coordX5179: pickNumber(row, ['CRD_INFO_X_EPSG5179']),
      coordY5179: pickNumber(row, ['CRD_INFO_Y_EPSG5179']),
      source: 'upstream',
      sourceLabel: '행정안전부 민방위대피시설',
    },
  };
}

function appendShelterCandidates(args: {
  rows: JsonRecord[];
  bbox: Bbox | null;
  dedupe: Set<string>;
  target: ShelterFeature[];
}): void {
  for (const row of args.rows) {
    const feature = rowToShelterFeature(row);
    if (!feature) continue;
    if (!includesCoordinate(args.bbox, feature.geometry.coordinates)) continue;

    const featureId = String(feature.id ?? '');
    if (args.dedupe.has(featureId)) continue;
    args.dedupe.add(featureId);
    args.target.push(feature);
  }
}

function sortShelterFeatures(features: ShelterFeature[]): ShelterFeature[] {
  return [...features].sort((left, right) => {
    const leftStatus = left.properties.operationStatus === '사용중' ? 1 : 0;
    const rightStatus = right.properties.operationStatus === '사용중' ? 1 : 0;
    if (leftStatus !== rightStatus) return rightStatus - leftStatus;

    const leftCapacity = left.properties.capacity ?? 0;
    const rightCapacity = right.properties.capacity ?? 0;
    if (leftCapacity !== rightCapacity) return rightCapacity - leftCapacity;

    return left.properties.name.localeCompare(right.properties.name, 'ko');
  });
}

async function buildResponse(args: {
  apiKey: string;
  upstreamUrl: string;
  bbox: Bbox | null;
  featureLimit: number;
  maxPages: number;
  sourceOnly: boolean;
}): Promise<{ json: Record<string, unknown>; source: 'mock' | 'upstream' }> {
  const requestKey = `${args.bbox ? `${args.bbox.west},${args.bbox.south},${args.bbox.east},${args.bbox.north}` : 'no-bbox'}:${args.featureLimit}:${args.maxPages}:${args.sourceOnly ? 'source' : 'data'}`;
  const cached = responseCache.get(requestKey);
  if (cached && Date.now() - cached.cachedAt < RESPONSE_CACHE_TTL_MS) {
    return { json: cached.json, source: cached.source };
  }

  const warnings: string[] = [];
  const updatedAt = new Date().toISOString();
  const firstPage = await fetchShelterPage({
    upstreamUrl: args.upstreamUrl,
    apiKey: args.apiKey,
    pageNo: 1,
  });

  if (firstPage.warning) warnings.push(firstPage.warning);

  const totalCount = firstPage.totalCount ?? 0;
  const effectivePageSize = Math.max(firstPage.rows.length, 1);
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / effectivePageSize) : 1;

  if (args.sourceOnly) {
    const source: 'mock' | 'upstream' = firstPage.rows.length > 0 ? 'upstream' : 'mock';
    const json = {
      source,
      updatedAt,
      totalCount,
      warnings,
    };
    responseCache.set(requestKey, {
      json,
      source,
      cachedAt: Date.now(),
    });
    return { json, source };
  }

  const candidates: ShelterFeature[] = [];
  const dedupe = new Set<string>();
  appendShelterCandidates({
    rows: firstPage.rows,
    bbox: args.bbox,
    dedupe,
    target: candidates,
  });

  const candidateTarget = buildCandidateTarget(args.featureLimit, Boolean(args.bbox));
  let fetchedPages = 1;
  let pageStart = 2;

  while (
    pageStart <= totalPages
    && pageStart <= args.maxPages
    && candidates.length < candidateTarget
  ) {
    const pageNumbers: number[] = [];
    for (
      let pageNo = pageStart;
      pageNo < pageStart + FETCH_BATCH_SIZE && pageNo <= totalPages && pageNo <= args.maxPages;
      pageNo += 1
    ) {
      pageNumbers.push(pageNo);
    }

    const pageResults = await Promise.all(
      pageNumbers.map((pageNo) =>
        fetchShelterPage({
          upstreamUrl: args.upstreamUrl,
          apiKey: args.apiKey,
          pageNo,
        })
      )
    );

    fetchedPages += pageResults.length;
    for (const page of pageResults) {
      if (page.warning) warnings.push(page.warning);
      appendShelterCandidates({
        rows: page.rows,
        bbox: args.bbox,
        dedupe,
        target: candidates,
      });
    }

    pageStart += FETCH_BATCH_SIZE;
  }

  const features = sortShelterFeatures(candidates).slice(0, args.featureLimit);
  const source: 'mock' | 'upstream' = firstPage.rows.length > 0 ? 'upstream' : 'mock';
  const json = {
    source,
    updatedAt,
    totalCount,
    matchedCount: candidates.length,
    data: {
      type: 'FeatureCollection',
      features,
    },
    meta: {
      featureLimit: args.featureLimit,
      featureCount: features.length,
      bboxApplied: Boolean(args.bbox),
      fetchedPages,
      totalPages,
      partialFetch: fetchedPages < totalPages,
    },
    warnings,
  };

  responseCache.set(requestKey, {
    json,
    source,
    cachedAt: Date.now(),
  });

  return { json, source };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const sourceOnlyRaw = (requestUrl.searchParams.get('sourceOnly') ?? '').trim().toLowerCase();
  const sourceOnly = sourceOnlyRaw === '1' || sourceOnlyRaw === 'true' || sourceOnlyRaw === 'yes';
  const bbox = parseBboxQueryParam(requestUrl.searchParams.get('bbox'));
  const featureLimit = clampFeatureLimit(requestUrl.searchParams.get('max'));
  const maxPages = clampInt(
    toPositiveInt(requestUrl.searchParams.get('maxPages'), DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );

  const apiKey =
    process.env.TEAM2_DISASTER_CIVIL_DEFENSE_SHELTER_API_KEY
    ?? process.env.TEAM2_DISASTER_API_KEY
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
          'Missing env: TEAM2_DISASTER_CIVIL_DEFENSE_SHELTER_API_KEY (or TEAM2_DISASTER_API_KEY / TEAM2_PUBLIC_API_KEY)',
        ],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  const result = await buildResponse({
    apiKey,
    upstreamUrl: process.env.TEAM2_DISASTER_CIVIL_DEFENSE_SHELTER_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL,
    bbox,
    featureLimit,
    maxPages,
    sourceOnly,
  });

  return NextResponse.json(result.json, {
    headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': result.source },
  });
}
