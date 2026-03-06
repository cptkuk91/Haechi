import { NextResponse } from 'next/server';
import type { Collection, Document, Filter } from 'mongodb';
import clientPromise from '@/lib/mongodb';
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

const DEFAULT_UPSTREAM_URL = 'http://apis.data.go.kr/B552016/PublicFacilSafetyMngService/getPublicFacilSafetyMngList';
const DEFAULT_COLLECTION_NAME = 'infra_public_facility_safety';
const DEFAULT_PAGE_SIZE = 20;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 500;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 5000;
const DEFAULT_MAX_FEATURES = 10_000;
const MIN_MAX_FEATURES = 1;
const MAX_MAX_FEATURES = 100_000;
const DEFAULT_SYNC_TTL_MINUTES = 360;
const MIN_SYNC_TTL_MINUTES = 10;
const MAX_SYNC_TTL_MINUTES = 1440;
const SUCCESS_CODES = new Set(['0', '00', 'NORMAL_CODE', 'NORMAL_SERVICE', 'SUCCESS']);

interface PublicFacilitySafetyDocument extends Document {
  sourceId: string;
  facilityNo: string | null;
  name: string;
  facilityCategory: string | null;
  facilityKind: string | null;
  safetyGrade: string | null;
  facilityClass: string | null;
  address: string | null;
  completionDate: string | null;
  nextInspectionDate: string | null;
  lastInspectionDate: string | null;
  buildingNo: string | null;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  syncedAt: Date;
  updatedAt: Date;
}

interface SyncSummary {
  source: 'mock' | 'upstream';
  storedCount: number;
  warnings: string[];
}

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface PageResult {
  rows: JsonRecord[];
  totalCount: number;
  warning?: string;
}

let ensureIndexesPromise: Promise<void> | null = null;
let syncInFlight: Promise<SyncSummary> | null = null;

function parseBboxQueryParam(raw: string | null): Bbox | null {
  if (!raw) return null;
  const [westRaw, southRaw, eastRaw, northRaw] = raw.split(',');
  if (!westRaw || !southRaw || !eastRaw || !northRaw) return null;

  const west = Number(westRaw);
  const south = Number(southRaw);
  const east = Number(eastRaw);
  const north = Number(northRaw);

  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;

  return { west, south, east, north };
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.map((warning) => compactText(warning)).filter(Boolean))];
}

function looksLikeAddress(value: string | null): boolean {
  if (!value) return false;
  const normalized = compactText(value);
  if (!normalized || /^[0-9]+\s*종$/.test(normalized)) return false;
  return normalized.includes(' ') && /[시도군구읍면동로길]/.test(normalized);
}

function pickFacilityAddress(row: JsonRecord): string | null {
  const direct = pickString(row, ['facilAddr']);
  if (direct) return direct;

  const fallback = pickString(row, ['address']);
  if (fallback) return fallback;

  const classAsAddress = pickString(row, ['facilClass']);
  return looksLikeAddress(classAsAddress) ? classAsAddress : null;
}

function pickFacilityClass(row: JsonRecord): string | null {
  const value = pickString(row, ['facilClass']);
  if (!value || looksLikeAddress(value)) return null;
  return value;
}

function buildSourceId(row: JsonRecord, fallbackIndex: number): string {
  const facilityNo = pickString(row, ['facilNo']);
  if (facilityNo) return facilityNo;

  const name = pickString(row, ['facilNm']) ?? `공공시설물안전-${fallbackIndex + 1}`;
  const address = pickFacilityAddress(row) ?? '';
  const base = [name, address].filter(Boolean).join('|');

  if (base) {
    return `public-facility-${Buffer.from(base).toString('base64url').slice(0, 64)}`;
  }

  return `public-facility-${fallbackIndex + 1}`;
}

function toFeatureId(sourceId: string): string {
  return `public-facility-safety-${sourceId.replace(/[^a-zA-Z0-9\uac00-\ud7a3_-]+/g, '-')}`;
}

function buildGeoWithinPolygon(bbox: Bbox): {
  $geometry: {
    type: 'Polygon';
    coordinates: [[[number, number], [number, number], [number, number], [number, number], [number, number]]];
  };
} {
  return {
    $geometry: {
      type: 'Polygon',
      coordinates: [[
        [bbox.west, bbox.south],
        [bbox.east, bbox.south],
        [bbox.east, bbox.north],
        [bbox.west, bbox.north],
        [bbox.west, bbox.south],
      ]],
    },
  };
}

async function fetchPage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
  pageSize: number;
}): Promise<PageResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('ServiceKey', args.apiKey);
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));
  url.searchParams.set('type', 'json');

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
      totalCount: 0,
      warning: `Public facility safety upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: 0,
      warning: 'Public facility safety upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json) ?? 0,
      warning:
        extractResultWarningFromCommonJson(json, 'Public facility safety API', SUCCESS_CODES)
        ?? undefined,
    };
  } catch {
    return {
      rows: [],
      totalCount: 0,
      warning: 'Public facility safety upstream returned invalid JSON',
    };
  }
}

async function ensureIndexes(collection: Collection<PublicFacilitySafetyDocument>): Promise<void> {
  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      await collection.createIndex({ sourceId: 1 }, { unique: true });
      await collection.createIndex({ location: '2dsphere' });
      await collection.createIndex({ syncedAt: -1 });
      await collection.createIndex({ safetyGrade: 1 });
    })().catch((error) => {
      ensureIndexesPromise = null;
      throw error;
    });
  }

  await ensureIndexesPromise;
}

async function getLatestSyncedAt(collection: Collection<PublicFacilitySafetyDocument>): Promise<Date | null> {
  const latest = await collection
    .find({}, { projection: { syncedAt: 1 } })
    .sort({ syncedAt: -1 })
    .limit(1)
    .next();

  if (!latest?.syncedAt) return null;
  return latest.syncedAt instanceof Date ? latest.syncedAt : new Date(latest.syncedAt);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function synchronizeFacilities(args: {
  collection: Collection<PublicFacilitySafetyDocument>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
}): Promise<SyncSummary> {
  const warnings: string[] = [];
  const docsById = new Map<string, PublicFacilitySafetyDocument>();
  let totalPages = 1;
  let rowIndex = 0;

  for (let pageNo = 1; pageNo <= totalPages && pageNo <= args.maxPages; pageNo += 1) {
    const page = await fetchPage({
      upstreamUrl: args.upstreamUrl,
      apiKey: args.apiKey,
      pageNo,
      pageSize: args.pageSize,
    });

    if (page.warning) warnings.push(page.warning);
    if (page.rows.length === 0) break;

    if (page.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(page.totalCount / args.pageSize));
    }

    for (const row of page.rows) {
      const lat = pickNumber(row, ['gisY']);
      const lng = pickNumber(row, ['gisX']);
      if (lat === null || lng === null) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

      const sourceId = buildSourceId(row, rowIndex);
      const syncedAt = new Date();

      docsById.set(sourceId, {
        sourceId,
        facilityNo: pickString(row, ['facilNo']),
        name: pickString(row, ['facilNm']) ?? `공공시설물안전-${rowIndex + 1}`,
        facilityCategory: pickString(row, ['facilGbn']),
        facilityKind: pickString(row, ['facilKind']),
        safetyGrade: pickString(row, ['sfGrade']),
        facilityClass: pickFacilityClass(row),
        address: pickFacilityAddress(row),
        completionDate: pickString(row, ['cplYmd']),
        nextInspectionDate: pickString(row, ['nextPcchkArrvlYmd']),
        lastInspectionDate: pickString(row, ['lastChckDignYmd', 'astChckDignYmd']),
        buildingNo: pickString(row, ['arNo']),
        location: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        syncedAt,
        updatedAt: syncedAt,
      });

      rowIndex += 1;
      if (docsById.size >= args.maxFeatures) break;
    }

    if (docsById.size >= args.maxFeatures) break;
    if (page.rows.length < args.pageSize) break;
  }

  const operations = [...docsById.values()].map((doc) => ({
    updateOne: {
      filter: { sourceId: doc.sourceId },
      update: { $set: doc },
      upsert: true,
    },
  }));

  for (const chunk of chunkArray(operations, 1000)) {
    if (chunk.length > 0) {
      await args.collection.bulkWrite(chunk, { ordered: false });
    }
  }

  if (docsById.size === 0) {
    await args.collection.deleteMany({});
  } else {
    await args.collection.deleteMany({ sourceId: { $nin: [...docsById.keys()] } });
  }

  return {
    source: docsById.size > 0 ? 'upstream' : 'mock',
    storedCount: docsById.size,
    warnings: uniqueWarnings(warnings),
  };
}

async function runSyncWithLock(args: {
  collection: Collection<PublicFacilitySafetyDocument>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
}): Promise<SyncSummary> {
  if (!syncInFlight) {
    syncInFlight = synchronizeFacilities(args).finally(() => {
      syncInFlight = null;
    });
  }

  return syncInFlight;
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const sourceOnlyRaw = (searchParams.get('sourceOnly') ?? '').trim().toLowerCase();
  const sourceOnly = sourceOnlyRaw === '1' || sourceOnlyRaw === 'true' || sourceOnlyRaw === 'yes';
  const refreshRaw = (searchParams.get('refresh') ?? '').trim().toLowerCase();
  const refresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'yes';

  const apiKey =
    process.env.TEAM2_INFRA_PUBLIC_FACILITY_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_INFRA_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  const collectionName = compactText(
    process.env.TEAM2_INFRA_PUBLIC_FACILITY_COLLECTION ?? DEFAULT_COLLECTION_NAME
  ) || DEFAULT_COLLECTION_NAME;
  const upstreamUrl =
    process.env.TEAM2_INFRA_PUBLIC_FACILITY_UPSTREAM_URL
    ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_INFRA_PUBLIC_FACILITY_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_INFRA_PUBLIC_FACILITY_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const defaultMaxFeatures = clampInt(
    toPositiveInt(process.env.TEAM2_INFRA_PUBLIC_FACILITY_MAX_FEATURES, DEFAULT_MAX_FEATURES),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );
  const maxFeatures = clampInt(
    toPositiveInt(searchParams.get('max'), defaultMaxFeatures),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );
  const syncTtlMinutes = clampInt(
    toPositiveInt(
      process.env.TEAM2_INFRA_PUBLIC_FACILITY_SYNC_TTL_MINUTES,
      DEFAULT_SYNC_TTL_MINUTES
    ),
    MIN_SYNC_TTL_MINUTES,
    MAX_SYNC_TTL_MINUTES
  );
  const syncTtlMs = syncTtlMinutes * 60_000;
  const bbox = parseBboxQueryParam(searchParams.get('bbox'));

  const client = await clientPromise;
  const collection = client.db('haechi').collection<PublicFacilitySafetyDocument>(collectionName);

  await ensureIndexes(collection);

  if (sourceOnly) {
    const [storedCount, latestSyncedAt] = await Promise.all([
      collection.countDocuments({}),
      getLatestSyncedAt(collection),
    ]);

    if (storedCount > 0) {
      return NextResponse.json(
        {
          source: 'upstream',
          updatedAt: new Date().toISOString(),
          syncedAt: latestSyncedAt?.toISOString() ?? null,
          storedCount,
          warnings: apiKey ? [] : ['Missing env: TEAM2_INFRA_PUBLIC_FACILITY_API_KEY (using stored collection only)'],
        },
        {
          headers: {
            'cache-control': 'no-store, max-age=0',
            'x-team2-source': 'upstream',
          },
        }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        {
          source: 'mock',
          updatedAt: new Date().toISOString(),
          storedCount: 0,
          warnings: ['Missing env: TEAM2_INFRA_PUBLIC_FACILITY_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_INFRA_API_KEY / TEAM2_PUBLIC_API_KEY)'],
        },
        {
          headers: {
            'cache-control': 'no-store, max-age=0',
            'x-team2-source': 'mock',
          },
        }
      );
    }

    try {
      const probe = await fetchPage({
        upstreamUrl,
        apiKey,
        pageNo: 1,
        pageSize: 1,
      });
      const warnings = probe.warning ? [probe.warning] : [];
      const source = warnings.length > 0 ? 'mock' : 'upstream';

      return NextResponse.json(
        {
          source,
          updatedAt: new Date().toISOString(),
          storedCount: 0,
          warnings,
        },
        {
          headers: {
            'cache-control': 'no-store, max-age=0',
            'x-team2-source': source,
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          source: 'mock',
          updatedAt: new Date().toISOString(),
          storedCount: 0,
          warnings: [`Public facility safety source probe failed: ${message}`],
        },
        {
          headers: {
            'cache-control': 'no-store, max-age=0',
            'x-team2-source': 'mock',
          },
        }
      );
    }
  }

  const runtimeWarnings: string[] = [];
  let latestSyncedAt = await getLatestSyncedAt(collection);
  let storedCount = await collection.countDocuments({});

  const shouldSync =
    refresh
    || storedCount === 0
    || !latestSyncedAt
    || (Date.now() - latestSyncedAt.getTime() > syncTtlMs);

  if (shouldSync && apiKey) {
    try {
      const syncResult = await runSyncWithLock({
        collection,
        upstreamUrl,
        apiKey,
        pageSize,
        maxPages,
        maxFeatures: defaultMaxFeatures,
      });
      runtimeWarnings.push(...syncResult.warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeWarnings.push(`Public facility safety sync failed: ${message}`);
    }

    latestSyncedAt = await getLatestSyncedAt(collection);
    storedCount = await collection.countDocuments({});
  } else if (shouldSync && !apiKey) {
    runtimeWarnings.push(
      'Missing env: TEAM2_INFRA_PUBLIC_FACILITY_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY, using stored collection only)'
    );
  }

  const filter: Filter<PublicFacilitySafetyDocument> = {};
  if (bbox) {
    filter.location = {
      $geoWithin: buildGeoWithinPolygon(bbox),
    };
  }

  const docs = await collection
    .find(filter)
    .sort({ name: 1 })
    .limit(maxFeatures)
    .toArray();

  const features: GeoJSON.Feature<GeoJSON.Point>[] = docs.map((doc) => {
    const featureId = toFeatureId(doc.sourceId);

    return {
      type: 'Feature',
      id: featureId,
      geometry: {
        type: 'Point',
        coordinates: doc.location.coordinates,
      },
      properties: {
        id: featureId,
        name: doc.name,
        category: '공공시설물 안전',
        facilityType: '공공시설물 안전',
        facilityNo: doc.facilityNo,
        facilityCategory: doc.facilityCategory,
        facilityKind: doc.facilityKind,
        safetyGrade: doc.safetyGrade,
        facilityClass: doc.facilityClass,
        address: doc.address,
        completionDate: doc.completionDate,
        nextInspectionDate: doc.nextInspectionDate,
        lastInspectionDate: doc.lastInspectionDate,
        buildingNo: doc.buildingNo,
        cplYmd: doc.completionDate,
        nextPcchkArrvlYmd: doc.nextInspectionDate,
        astChckDignYmd: doc.lastInspectionDate,
        source: 'public-facility-safety-db',
        status: doc.safetyGrade ?? 'unknown',
      },
    };
  });

  const source = storedCount > 0 ? 'upstream' : 'mock';
  const warnings = uniqueWarnings(runtimeWarnings);

  return NextResponse.json(
    {
      source,
      updatedAt: new Date().toISOString(),
      syncedAt: latestSyncedAt?.toISOString() ?? null,
      storedCount,
      data: source === 'upstream'
        ? {
            type: 'FeatureCollection',
            features,
          }
        : emptyFeatureCollection(),
      warnings,
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': source,
      },
    }
  );
}
