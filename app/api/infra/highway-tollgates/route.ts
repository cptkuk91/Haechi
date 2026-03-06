import { NextResponse } from 'next/server';
import type { Collection, Document, Filter } from 'mongodb';
import clientPromise from '@/lib/mongodb';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
  compactText,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';

const DEFAULT_UPSTREAM_URL = 'https://data.ex.co.kr/openapi/locationinfo/locationinfoUnit';
const DEFAULT_COLLECTION_NAME = 'infra_highway_tollgates';
const DEFAULT_PAGE_SIZE = 200;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 200;
const DEFAULT_MAX_FEATURES = 5000;
const MIN_MAX_FEATURES = 1;
const MAX_MAX_FEATURES = 20000;
const DEFAULT_SYNC_TTL_MINUTES = 1440;
const MIN_SYNC_TTL_MINUTES = 30;
const MAX_SYNC_TTL_MINUTES = 10080;
const SUCCESS_CODES = new Set(['0', '00', '000', 'INFO-000', 'NORMAL_SERVICE', 'SUCCESS', 'SUCCESSFUL']);
const WEB_MERCATOR_LIMIT = 20037508.342789244;

interface HighwayTollgateDocument extends Document {
  sourceId: string;
  unitCode: string | null;
  unitName: string;
  routeNo: string | null;
  routeName: string | null;
  useYn: string | null;
  rawX: number | null;
  rawY: number | null;
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

function isValidLngLat(lng: number, lat: number): boolean {
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function webMercatorToLngLat(x: number, y: number): [number, number] | null {
  if (Math.abs(x) > WEB_MERCATOR_LIMIT || Math.abs(y) > WEB_MERCATOR_LIMIT) return null;

  const lng = (x / WEB_MERCATOR_LIMIT) * 180;
  const latDegrees = (y / WEB_MERCATOR_LIMIT) * 180;
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((latDegrees * Math.PI) / 180)) - Math.PI / 2);

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (!isValidLngLat(lng, lat)) return null;
  return [lng, lat];
}

function normalizeCoordinates(x: number | null, y: number | null): [number, number] | null {
  if (x === null || y === null) return null;

  if (isValidLngLat(x, y)) return [x, y];
  if (Math.abs(x) <= 90 && Math.abs(y) <= 180 && isValidLngLat(y, x)) return [y, x];

  return webMercatorToLngLat(x, y);
}

function buildSourceId(row: JsonRecord, fallbackIndex: number): string {
  const unitCode = pickString(row, ['unitCode']);
  if (unitCode) return unitCode;

  const unitName = pickString(row, ['unitName']) ?? `도로공사영업소-${fallbackIndex + 1}`;
  const routeNo = pickString(row, ['routeNo']) ?? '';
  const routeName = pickString(row, ['routeName']) ?? '';
  const base = [unitName, routeNo, routeName].filter(Boolean).join('|');

  if (base) {
    return `highway-tollgate-${Buffer.from(base).toString('base64url').slice(0, 64)}`;
  }

  return `highway-tollgate-${fallbackIndex + 1}`;
}

function toFeatureId(sourceId: string): string {
  return `highway-tollgate-${sourceId.replace(/[^a-zA-Z0-9\uac00-\ud7a3_-]+/g, '-')}`;
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

function extractExpresswayWarning(raw: JsonRecord): string | null {
  const code = typeof raw.code === 'string' ? raw.code.trim() : null;
  const message = typeof raw.message === 'string' ? raw.message.trim() : null;

  if (!code || SUCCESS_CODES.has(code)) return null;
  return `Highway tollgate API [${code}] ${message || 'Unknown error'}`;
}

async function fetchPage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
  pageSize: number;
}): Promise<PageResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('key', args.apiKey);
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
      warning: `Highway tollgate upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: 0,
      warning: 'Highway tollgate upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text) as JsonRecord;
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json) ?? 0,
      warning: extractExpresswayWarning(json) ?? undefined,
    };
  } catch {
    return {
      rows: [],
      totalCount: 0,
      warning: 'Highway tollgate upstream returned invalid JSON',
    };
  }
}

async function ensureIndexes(collection: Collection<HighwayTollgateDocument>): Promise<void> {
  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      await collection.createIndex({ sourceId: 1 }, { unique: true });
      await collection.createIndex({ location: '2dsphere' });
      await collection.createIndex({ syncedAt: -1 });
      await collection.createIndex({ routeNo: 1 });
    })().catch((error) => {
      ensureIndexesPromise = null;
      throw error;
    });
  }

  await ensureIndexesPromise;
}

async function getLatestSyncedAt(collection: Collection<HighwayTollgateDocument>): Promise<Date | null> {
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

async function synchronizeTollgates(args: {
  collection: Collection<HighwayTollgateDocument>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
}): Promise<SyncSummary> {
  const warnings: string[] = [];
  const docsById = new Map<string, HighwayTollgateDocument>();
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
      const rawX = pickNumber(row, ['xValue', 'x']);
      const rawY = pickNumber(row, ['yValue', 'y']);
      const coordinates = normalizeCoordinates(rawX, rawY);
      if (!coordinates) continue;

      const sourceId = buildSourceId(row, rowIndex);
      const syncedAt = new Date();

      docsById.set(sourceId, {
        sourceId,
        unitCode: pickString(row, ['unitCode']),
        unitName: pickString(row, ['unitName']) ?? `도로공사영업소-${rowIndex + 1}`,
        routeNo: pickString(row, ['routeNo']),
        routeName: pickString(row, ['routeName']),
        useYn: pickString(row, ['useYn']),
        rawX,
        rawY,
        location: {
          type: 'Point',
          coordinates,
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
  collection: Collection<HighwayTollgateDocument>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
}): Promise<SyncSummary> {
  if (!syncInFlight) {
    syncInFlight = synchronizeTollgates(args).finally(() => {
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
    process.env.TEAM2_EXPRESSWAY_API_KEY
    ?? process.env.TEAM2_INFRA_HIGHWAY_TOLLGATE_API_KEY;

  const collectionName = compactText(
    process.env.TEAM2_INFRA_HIGHWAY_TOLLGATE_COLLECTION ?? DEFAULT_COLLECTION_NAME
  ) || DEFAULT_COLLECTION_NAME;
  const upstreamUrl =
    process.env.TEAM2_INFRA_HIGHWAY_TOLLGATE_UPSTREAM_URL
    ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_INFRA_HIGHWAY_TOLLGATE_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_INFRA_HIGHWAY_TOLLGATE_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const defaultMaxFeatures = clampInt(
    toPositiveInt(process.env.TEAM2_INFRA_HIGHWAY_TOLLGATE_MAX_FEATURES, DEFAULT_MAX_FEATURES),
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
      process.env.TEAM2_INFRA_HIGHWAY_TOLLGATE_SYNC_TTL_MINUTES,
      DEFAULT_SYNC_TTL_MINUTES
    ),
    MIN_SYNC_TTL_MINUTES,
    MAX_SYNC_TTL_MINUTES
  );
  const syncTtlMs = syncTtlMinutes * 60_000;
  const bbox = parseBboxQueryParam(searchParams.get('bbox'));

  const client = await clientPromise;
  const collection = client.db('haechi').collection<HighwayTollgateDocument>(collectionName);

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
          warnings: apiKey ? [] : ['Missing env: TEAM2_EXPRESSWAY_API_KEY (using stored collection only)'],
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
          warnings: ['Missing env: TEAM2_EXPRESSWAY_API_KEY'],
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
          warnings: [`Highway tollgate source probe failed: ${message}`],
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
      runtimeWarnings.push(`Highway tollgate sync failed: ${message}`);
    }

    latestSyncedAt = await getLatestSyncedAt(collection);
    storedCount = await collection.countDocuments({});
  } else if (shouldSync && !apiKey) {
    runtimeWarnings.push('Missing env: TEAM2_EXPRESSWAY_API_KEY (using stored collection only)');
  }

  const filter: Filter<HighwayTollgateDocument> = {};
  if (bbox) {
    filter.location = {
      $geoWithin: buildGeoWithinPolygon(bbox),
    };
  }

  const docs = await collection
    .find(filter)
    .sort({ routeName: 1, unitName: 1 })
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
        name: doc.unitName,
        category: '도로공사 영업소',
        facilityType: '도로공사 영업소',
        unitCode: doc.unitCode,
        unitName: doc.unitName,
        routeNo: doc.routeNo,
        routeName: doc.routeName,
        useYn: doc.useYn,
        xValue: doc.rawX,
        yValue: doc.rawY,
        source: 'highway-tollgate-db',
        status: doc.useYn ?? '운영',
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
