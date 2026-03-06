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

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/1383000/gmis/mtpcltFamSpcnServiceV2/getMtpcltFamSpcnListV2';
const DEFAULT_COLLECTION_NAME = 'vulnerable_multicultural_support_centers';
const DEFAULT_PAGE_SIZE = 100;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 20;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 100;
const DEFAULT_MAX_FEATURES = 2000;
const MIN_MAX_FEATURES = 1;
const MAX_MAX_FEATURES = 20_000;
const DEFAULT_SYNC_TTL_MINUTES = 360;
const MIN_SYNC_TTL_MINUTES = 10;
const MAX_SYNC_TTL_MINUTES = 1440;
const SUCCESS_CODES = new Set(['0', '00', 'INFO-000', 'NORMAL_SERVICE', 'SUCCESS']);

interface MulticulturalSupportCenterDocument extends Document {
  sourceId: string;
  name: string;
  facilityType: string;
  managerName: string | null;
  representativePhone: string | null;
  consultPhone: string | null;
  fax: string | null;
  email: string | null;
  homepage: string | null;
  roadAddress: string | null;
  oldAddress: string | null;
  address: string | null;
  sido: string | null;
  sigungu: string | null;
  providerLanguages: string | null;
  operatingHours: string | null;
  employeeCount: number | null;
  operationAgency: string | null;
  operationMode: string | null;
  exposedYn: boolean;
  remarks: string | null;
  crtrYmd: string | null;
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

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
}

function parseBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'y', 'yes'].includes(normalized)) return true;
    if (['0', 'false', 'n', 'no'].includes(normalized)) return false;
  }
  return null;
}

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

function buildSourceId(row: JsonRecord, fallbackIndex: number): string {
  const name = pickString(row, ['cnterNm']) ?? `다문화가족지원센터-${fallbackIndex + 1}`;
  const roadAddress = pickString(row, ['roadNmAddr']) ?? '';
  const oldAddress = pickString(row, ['lotnoAddr']) ?? '';
  const representativePhone = pickString(row, ['rprsTelno']) ?? '';
  const base = [name, roadAddress, oldAddress, representativePhone].filter(Boolean).join('|');

  if (base) {
    return `mtpclt-${Buffer.from(base).toString('base64url').slice(0, 64)}`;
  }

  return `mtpclt-${fallbackIndex + 1}`;
}

function toFeatureId(sourceId: string): string {
  return `multicultural-support-center-${sourceId.replace(/[^a-zA-Z0-9\uac00-\ud7a3_-]+/g, '-')}`;
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
  url.searchParams.set('serviceKey', args.apiKey);
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
      warning: `Multicultural support center upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: 0,
      warning: 'Multicultural support center upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json) ?? 0,
      warning:
        extractResultWarningFromCommonJson(json, 'Multicultural support center API', SUCCESS_CODES)
        ?? undefined,
    };
  } catch {
    return {
      rows: [],
      totalCount: 0,
      warning: 'Multicultural support center upstream returned invalid JSON',
    };
  }
}

async function ensureIndexes(collection: Collection<MulticulturalSupportCenterDocument>): Promise<void> {
  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      await collection.createIndex({ sourceId: 1 }, { unique: true });
      await collection.createIndex({ location: '2dsphere' });
      await collection.createIndex({ syncedAt: -1 });
      await collection.createIndex({ exposedYn: 1 });
    })().catch((error) => {
      ensureIndexesPromise = null;
      throw error;
    });
  }

  await ensureIndexesPromise;
}

async function getLatestSyncedAt(collection: Collection<MulticulturalSupportCenterDocument>): Promise<Date | null> {
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

async function synchronizeCenters(args: {
  collection: Collection<MulticulturalSupportCenterDocument>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
  onlyExposed: boolean;
}): Promise<SyncSummary> {
  const warnings: string[] = [];
  const docsById = new Map<string, MulticulturalSupportCenterDocument>();
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
      const lat = pickNumber(row, ['lat']);
      const lng = pickNumber(row, ['lot']);
      if (lat === null || lng === null) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

      const exposedYn = parseBooleanValue(row.expsrYn) ?? true;
      if (args.onlyExposed && !exposedYn) continue;

      const name = pickString(row, ['cnterNm']) ?? `다문화가족지원센터-${rowIndex + 1}`;
      const roadAddress = pickString(row, ['roadNmAddr']);
      const oldAddress = pickString(row, ['lotnoAddr']);
      const address = roadAddress ?? oldAddress ?? null;
      const sourceId = buildSourceId(row, rowIndex);
      const syncedAt = new Date();

      docsById.set(sourceId, {
        sourceId,
        name,
        facilityType: '다문화가족지원센터',
        managerName: pickString(row, ['cnterChNm']),
        representativePhone: pickString(row, ['rprsTelno']),
        consultPhone: pickString(row, ['dscsnTelno']),
        fax: pickString(row, ['fxno']),
        email: pickString(row, ['emlAddr']),
        homepage: pickString(row, ['hmpgAddr']),
        roadAddress,
        oldAddress,
        address,
        sido: pickString(row, ['ctpvNm']),
        sigungu: pickString(row, ['sggNm']),
        providerLanguages: pickString(row, ['pvsnLngNm']),
        operatingHours: pickString(row, ['operHrCn']),
        employeeCount: pickNumber(row, ['empCnt']),
        operationAgency: pickString(row, ['operMbyCn']),
        operationMode: pickString(row, ['operModeCn']),
        exposedYn,
        remarks: pickString(row, ['rmrkCn']),
        crtrYmd: pickString(row, ['crtrYmd']),
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
  collection: Collection<MulticulturalSupportCenterDocument>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
  onlyExposed: boolean;
}): Promise<SyncSummary> {
  if (!syncInFlight) {
    syncInFlight = synchronizeCenters(args).finally(() => {
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
    process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_VULNERABLE_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  const collectionName = compactText(
    process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_COLLECTION ?? DEFAULT_COLLECTION_NAME
  ) || DEFAULT_COLLECTION_NAME;
  const upstreamUrl =
    process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_UPSTREAM_URL
    ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const defaultMaxFeatures = clampInt(
    toPositiveInt(process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_MAX_FEATURES, DEFAULT_MAX_FEATURES),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );
  const maxFeatures = clampInt(
    toPositiveInt(searchParams.get('max'), defaultMaxFeatures),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );
  const onlyExposed = parseBoolean(
    process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_ONLY_EXPOSED,
    true
  );
  const syncTtlMinutes = clampInt(
    toPositiveInt(
      process.env.TEAM2_MULTICULTURAL_SUPPORT_CENTER_SYNC_TTL_MINUTES,
      DEFAULT_SYNC_TTL_MINUTES
    ),
    MIN_SYNC_TTL_MINUTES,
    MAX_SYNC_TTL_MINUTES
  );
  const syncTtlMs = syncTtlMinutes * 60_000;
  const bbox = parseBboxQueryParam(searchParams.get('bbox'));

  const client = await clientPromise;
  const collection = client.db('haechi').collection<MulticulturalSupportCenterDocument>(collectionName);

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
          warnings: apiKey ? [] : ['Missing env: TEAM2_MULTICULTURAL_SUPPORT_CENTER_API_KEY (using stored collection only)'],
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
          warnings: ['Missing env: TEAM2_MULTICULTURAL_SUPPORT_CENTER_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_VULNERABLE_API_KEY / TEAM2_PUBLIC_API_KEY)'],
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
          warnings: [`Multicultural support center source probe failed: ${message}`],
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
        onlyExposed,
      });
      runtimeWarnings.push(...syncResult.warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runtimeWarnings.push(`Multicultural support center sync failed: ${message}`);
    }

    latestSyncedAt = await getLatestSyncedAt(collection);
    storedCount = await collection.countDocuments({});
  } else if (shouldSync && !apiKey) {
    runtimeWarnings.push(
      'Missing env: TEAM2_MULTICULTURAL_SUPPORT_CENTER_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY, using stored collection only)'
    );
  }

  const filter: Filter<MulticulturalSupportCenterDocument> = {};
  if (onlyExposed) {
    filter.exposedYn = true;
  }
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
        category: doc.facilityType,
        facilityType: doc.facilityType,
        phone: doc.representativePhone,
        consultPhone: doc.consultPhone,
        fax: doc.fax,
        email: doc.email,
        homepage: doc.homepage,
        roadAddress: doc.roadAddress,
        oldAddress: doc.oldAddress,
        address: doc.address,
        managerName: doc.managerName,
        languages: doc.providerLanguages,
        operHours: doc.operatingHours,
        employeeCount: doc.employeeCount,
        operAgency: doc.operationAgency,
        operMode: doc.operationMode,
        remarks: doc.remarks,
        ctpvNm: doc.sido,
        sggNm: doc.sigungu,
        crtrYmd: doc.crtrYmd,
        exposedYn: doc.exposedYn,
        source: 'multicultural-support-center-db',
        status: 'active',
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
