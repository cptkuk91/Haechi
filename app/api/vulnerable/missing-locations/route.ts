import { NextResponse } from 'next/server';
import type { Collection, Document } from 'mongodb';
import clientPromise from '@/lib/mongodb';
import { clampInt, compactText, toPositiveInt } from '@/app/api/_shared/parse-primitives';

const SAFE182_URL = 'https://www.safe182.go.kr/api/lcm/amberList.do';
const DEFAULT_COLLECTION_NAME = 'vulnerable_missing_locations';
const DEFAULT_ROW_SIZE = 100;
const MIN_ROW_SIZE = 1;
const MAX_ROW_SIZE = 500;
const DEFAULT_MAX_PAGES = 200;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 1000;
const DEFAULT_MAX_FEATURES = 5000;
const MIN_MAX_FEATURES = 1;
const MAX_MAX_FEATURES = 20_000;
const DEFAULT_SYNC_TTL_MINUTES = 360;
const MIN_SYNC_TTL_MINUTES = 10;
const MAX_SYNC_TTL_MINUTES = 1440;

interface Safe182Item {
  occrAdres?: string;
  [key: string]: unknown;
}

interface Safe182Response {
  totalCount?: number;
  list?: Safe182Item[];
}

interface DongCoordinate {
  fullAddress: string;
  sidoName: string;
  sigunguName: string;
  lat: number | null;
  lng: number | null;
}

interface MissingLocationDocument extends Document {
  locationKey: string;
  address: string;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  count: number;
  weight: number;
  syncedAt: Date;
  updatedAt: Date;
}

interface MissingLocationMetaDocument extends Document {
  _id: 'current';
  totalCount: number;
  matchedCount: number;
  unparsedCount: number;
  unmatchedCount: number;
  warnings: string[];
  syncedAt: Date;
  updatedAt: Date;
}

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface SyncSummary {
  source: 'mock' | 'upstream';
  storedCount: number;
  totalCount: number;
  matchedCount: number;
  syncedAt: Date | null;
  warnings: string[];
}

interface QuerySummary {
  source: 'mock' | 'upstream';
  storedCount: number;
  totalCount: number;
  matchedCount: number;
  syncedAt: string | null;
  warnings: string[];
  features: GeoJSON.Feature<GeoJSON.Point>[];
}

const SIDO_ALIAS: Record<string, string> = {
  서울: '서울특별시',
  부산: '부산광역시',
  대구: '대구광역시',
  인천: '인천광역시',
  광주: '광주광역시',
  대전: '대전광역시',
  울산: '울산광역시',
  세종: '세종특별자치시',
  경기: '경기도',
  강원: '강원특별자치도',
  충북: '충청북도',
  충남: '충청남도',
  전남: '전라남도',
  경북: '경상북도',
  경남: '경상남도',
  제주: '제주특별자치도',
  강원도: '강원특별자치도',
  전라북도: '전북특별자치도',
  전북: '전북특별자치도',
  광주시: '광주광역시',
  안산: '경기도',
};

const SIGUNGU_ALIAS: Record<string, { sido: string; sigungu: string }> = {
  '경상남도 진해시': { sido: '경상남도', sigungu: '창원시 진해구' },
  '경상북도 군위군': { sido: '대구광역시', sigungu: '군위군' },
};

let ensureIndexesPromise: Promise<void> | null = null;
let syncInFlight: Promise<SyncSummary> | null = null;

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
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

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function uniqueWarnings(warnings: string[]): string[] {
  const filtered = warnings
    .map((warning) => compactText(warning))
    .filter(Boolean);
  return [...new Set(filtered)];
}

function parseAddress(raw: string): { sido: string; sigungu: string; dong: string | null } | null {
  const trimmed = compactText(raw);
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;

  const sido = SIDO_ALIAS[parts[0]] ?? parts[0];
  const sigungu = parts[1];

  const dongSuffixes = /[동읍면가리]$/;
  for (let i = 2; i < parts.length; i += 1) {
    if (dongSuffixes.test(parts[i])) {
      return { sido, sigungu, dong: parts[i] };
    }
  }

  return { sido, sigungu, dong: null };
}

async function fetchSafe182Page(args: {
  esntlId: string;
  authKey: string;
  rowSize: number;
  page: number;
}): Promise<Safe182Response> {
  const body = new URLSearchParams({
    esntlId: args.esntlId,
    authKey: args.authKey,
    rowSize: String(args.rowSize),
    page: String(args.page),
  });

  const res = await fetch(SAFE182_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`safe182 API responded ${res.status}`);
  }

  return (await res.json()) as Safe182Response;
}

async function fetchAllPages(args: {
  esntlId: string;
  authKey: string;
  rowSize: number;
  maxPages: number;
}): Promise<{ items: Safe182Item[]; totalCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  const allItems: Safe182Item[] = [];

  let totalCount = 0;

  for (let page = 1; page <= args.maxPages; page += 1) {
    const json = await fetchSafe182Page({
      esntlId: args.esntlId,
      authKey: args.authKey,
      rowSize: args.rowSize,
      page,
    });

    if (page === 1) {
      totalCount = typeof json.totalCount === 'number' ? json.totalCount : 0;
    }

    const list = Array.isArray(json.list) ? json.list : [];
    allItems.push(...list);

    if (totalCount > 0 && allItems.length >= totalCount) {
      break;
    }

    if (list.length < args.rowSize) {
      break;
    }
  }

  if (totalCount > allItems.length) {
    warnings.push(`safe182 max pages reached: ${allItems.length}/${totalCount} rows loaded`);
  }

  return {
    items: allItems,
    totalCount: totalCount > 0 ? totalCount : allItems.length,
    warnings,
  };
}

async function fetchSourceProbe(esntlId: string, authKey: string): Promise<{ totalCount: number }> {
  const body = new URLSearchParams({
    esntlId,
    authKey,
    rowSize: '1',
    page: '1',
  });

  const res = await fetch(SAFE182_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`safe182 API responded ${res.status}`);
  }

  const json = (await res.json()) as Safe182Response;
  return {
    totalCount: typeof json.totalCount === 'number' ? json.totalCount : 0,
  };
}

async function buildCoordMaps(collection: Collection<Document>) {
  const docs = await collection
    .find({ lat: { $ne: null }, lng: { $ne: null } })
    .project<DongCoordinate>({ fullAddress: 1, sidoName: 1, sigunguName: 1, lat: 1, lng: 1 })
    .toArray();

  const exactMap = new Map<string, { lat: number; lng: number }>();
  const sigunguMap = new Map<string, { lat: number; lng: number }>();

  for (const doc of docs) {
    if (doc.lat == null || doc.lng == null) continue;

    exactMap.set(doc.fullAddress, { lat: doc.lat, lng: doc.lng });

    const key = `${doc.sidoName} ${doc.sigunguName}`;
    if (!sigunguMap.has(key)) {
      sigunguMap.set(key, { lat: doc.lat, lng: doc.lng });
    }

    const siParts = doc.sigunguName.split(/\s+/);
    if (siParts.length > 1) {
      const siKey = `${doc.sidoName} ${siParts[0]}`;
      if (!sigunguMap.has(siKey)) {
        sigunguMap.set(siKey, { lat: doc.lat, lng: doc.lng });
      }
    }
  }

  return { exactMap, sigunguMap };
}

async function ensureIndexes(
  collection: Collection<MissingLocationDocument>,
  metaCollection: Collection<MissingLocationMetaDocument>
): Promise<void> {
  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      await collection.createIndex({ locationKey: 1 }, { unique: true });
      await collection.createIndex({ location: '2dsphere' });
      await collection.createIndex({ syncedAt: -1 });
      await metaCollection.createIndex({ syncedAt: -1 });
    })().catch((error) => {
      ensureIndexesPromise = null;
      throw error;
    });
  }

  await ensureIndexesPromise;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function synchronizeMissingLocations(args: {
  esntlId: string;
  authKey: string;
  rowSize: number;
  maxPages: number;
  collection: Collection<MissingLocationDocument>;
  metaCollection: Collection<MissingLocationMetaDocument>;
  dongCollection: Collection<Document>;
}): Promise<SyncSummary> {
  const warnings: string[] = [];

  const fetched = await fetchAllPages({
    esntlId: args.esntlId,
    authKey: args.authKey,
    rowSize: args.rowSize,
    maxPages: args.maxPages,
  });

  warnings.push(...fetched.warnings);

  const { exactMap, sigunguMap } = await buildCoordMaps(args.dongCollection);

  const locationCounts = new Map<string, { lat: number; lng: number; count: number; address: string }>();
  let unparsedCount = 0;
  let unmatchedCount = 0;

  for (const item of fetched.items) {
    const addr = typeof item.occrAdres === 'string' ? item.occrAdres : '';
    const parsed = parseAddress(addr);

    if (!parsed) {
      unparsedCount += 1;
      continue;
    }

    let coord: { lat: number; lng: number } | undefined;
    let locationKey = '';

    if (parsed.dong) {
      const fullAddr = `${parsed.sido} ${parsed.sigungu} ${parsed.dong}`;
      coord = exactMap.get(fullAddr);
      locationKey = fullAddr;
    }

    if (!coord) {
      const sigunguKey = `${parsed.sido} ${parsed.sigungu}`;
      coord = sigunguMap.get(sigunguKey);
      locationKey = sigunguKey;
    }

    if (!coord && !/[시군구]$/.test(parsed.sigungu)) {
      const withSi = `${parsed.sido} ${parsed.sigungu}시`;
      coord = sigunguMap.get(withSi);
      if (coord) locationKey = withSi;
    }

    if (!coord) {
      const aliasKey = `${parsed.sido} ${parsed.sigungu}`;
      const alias = SIGUNGU_ALIAS[aliasKey];
      if (alias) {
        const aliasFullKey = `${alias.sido} ${alias.sigungu}`;
        coord = sigunguMap.get(aliasFullKey);
        if (coord) locationKey = aliasFullKey;
      }
    }

    if (!coord) {
      unmatchedCount += 1;
      continue;
    }

    const existing = locationCounts.get(locationKey);
    if (existing) {
      existing.count += 1;
    } else {
      locationCounts.set(locationKey, {
        ...coord,
        count: 1,
        address: locationKey,
      });
    }
  }

  if (unparsedCount > 0) {
    warnings.push(`${unparsedCount}건의 주소를 파싱할 수 없습니다`);
  }
  if (unmatchedCount > 0) {
    warnings.push(`${unmatchedCount}건의 주소를 좌표에 매칭할 수 없습니다`);
  }

  const syncedAt = new Date();
  const docs: MissingLocationDocument[] = [];

  for (const [locationKey, loc] of locationCounts) {
    docs.push({
      locationKey,
      address: loc.address,
      location: {
        type: 'Point',
        coordinates: [loc.lng, loc.lat],
      },
      count: loc.count,
      weight: Math.min(loc.count / 3, 1),
      syncedAt,
      updatedAt: syncedAt,
    });
  }

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: { locationKey: doc.locationKey },
      update: { $set: doc },
      upsert: true,
    },
  }));

  for (const chunk of chunkArray(operations, 1000)) {
    if (chunk.length > 0) {
      await args.collection.bulkWrite(chunk, { ordered: false });
    }
  }

  if (docs.length === 0) {
    await args.collection.deleteMany({});
  } else {
    const keys = docs.map((doc) => doc.locationKey);
    await args.collection.deleteMany({ locationKey: { $nin: keys } });
  }

  const matchedCount = docs.reduce((sum, doc) => sum + doc.count, 0);
  const dedupedWarnings = uniqueWarnings(warnings);

  await args.metaCollection.updateOne(
    { _id: 'current' },
    {
      $set: {
        totalCount: fetched.totalCount,
        matchedCount,
        unparsedCount,
        unmatchedCount,
        warnings: dedupedWarnings,
        syncedAt,
        updatedAt: syncedAt,
      },
    },
    { upsert: true }
  );

  return {
    source: docs.length > 0 ? 'upstream' : 'mock',
    storedCount: docs.length,
    totalCount: fetched.totalCount,
    matchedCount,
    syncedAt,
    warnings: dedupedWarnings,
  };
}

async function runSyncWithLock(args: {
  esntlId: string;
  authKey: string;
  rowSize: number;
  maxPages: number;
  collection: Collection<MissingLocationDocument>;
  metaCollection: Collection<MissingLocationMetaDocument>;
  dongCollection: Collection<Document>;
}): Promise<SyncSummary> {
  if (!syncInFlight) {
    syncInFlight = synchronizeMissingLocations(args).finally(() => {
      syncInFlight = null;
    });
  }

  return syncInFlight;
}

async function queryMissingLocations(args: {
  collection: Collection<MissingLocationDocument>;
  metaCollection: Collection<MissingLocationMetaDocument>;
  maxFeatures: number;
  bbox: Bbox | null;
}): Promise<QuerySummary> {
  const filter: Document = {};

  if (args.bbox) {
    filter.location = {
      $geoWithin: {
        $box: [
          [args.bbox.west, args.bbox.south],
          [args.bbox.east, args.bbox.north],
        ],
      },
    };
  }

  const [storedCount, meta, docs] = await Promise.all([
    args.collection.estimatedDocumentCount(),
    args.metaCollection.findOne({ _id: 'current' }),
    args.collection
      .find(filter)
      .sort({ count: -1 })
      .limit(args.maxFeatures)
      .toArray(),
  ]);

  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (let index = 0; index < docs.length; index += 1) {
    const doc = docs[index];
    const coordinates = doc.location?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;

    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    features.push({
      type: 'Feature',
      id: `missing-location-${index + 1}`,
      geometry: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      properties: {
        address: doc.address,
        count: doc.count,
        weight: doc.weight,
      },
    });
  }

  const fallbackMatchedCount = docs.reduce((sum, doc) => sum + (Number.isFinite(doc.count) ? doc.count : 0), 0);
  const metaTotalCount = typeof meta?.totalCount === 'number' ? meta.totalCount : fallbackMatchedCount;
  const metaMatchedCount = typeof meta?.matchedCount === 'number' ? meta.matchedCount : fallbackMatchedCount;
  const syncedAt = toDate(meta?.syncedAt);
  const warnings = Array.isArray(meta?.warnings)
    ? meta.warnings.filter((warning): warning is string => typeof warning === 'string' && Boolean(warning.trim()))
    : [];

  return {
    source: storedCount > 0 ? 'upstream' : 'mock',
    storedCount,
    totalCount: metaTotalCount,
    matchedCount: metaMatchedCount,
    syncedAt: syncedAt ? syncedAt.toISOString() : null,
    warnings,
    features,
  };
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const sourceOnlyRaw = (searchParams.get('sourceOnly') ?? '').trim().toLowerCase();
  const sourceOnly = sourceOnlyRaw === '1' || sourceOnlyRaw === 'true' || sourceOnlyRaw === 'yes';
  const refreshRaw = (searchParams.get('refresh') ?? '').trim().toLowerCase();
  const refresh = refreshRaw === '1' || refreshRaw === 'true' || refreshRaw === 'yes';

  const esntlId = process.env.TEAM2_SAFE182_ESNTL_ID;
  const authKey = process.env.TEAM2_SAFE182_AUTH_KEY;
  const collectionName = compactText(process.env.TEAM2_MISSING_LOCATIONS_COLLECTION ?? DEFAULT_COLLECTION_NAME)
    || DEFAULT_COLLECTION_NAME;

  const rowSize = clampInt(
    toPositiveInt(process.env.TEAM2_MISSING_LOCATIONS_ROW_SIZE, DEFAULT_ROW_SIZE),
    MIN_ROW_SIZE,
    MAX_ROW_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_MISSING_LOCATIONS_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const defaultMaxFeatures = clampInt(
    toPositiveInt(process.env.TEAM2_MISSING_LOCATIONS_MAX_FEATURES, DEFAULT_MAX_FEATURES),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );
  const maxFeatures = clampInt(
    toPositiveInt(searchParams.get('max'), defaultMaxFeatures),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );
  const syncTtlMinutes = clampInt(
    toPositiveInt(process.env.TEAM2_MISSING_LOCATIONS_SYNC_TTL_MINUTES, DEFAULT_SYNC_TTL_MINUTES),
    MIN_SYNC_TTL_MINUTES,
    MAX_SYNC_TTL_MINUTES
  );
  const syncTtlMs = syncTtlMinutes * 60_000;

  const bbox = parseBboxQueryParam(searchParams.get('bbox'));

  const client = await clientPromise;
  const db = client.db('haechi');
  const collection = db.collection<MissingLocationDocument>(collectionName);
  const metaCollection = db.collection<MissingLocationMetaDocument>(`${collectionName}_meta`);
  const dongCollection = db.collection<Document>('dong_coordinates');

  await ensureIndexes(collection, metaCollection);

  if (sourceOnly) {
    const [storedCount, meta] = await Promise.all([
      collection.estimatedDocumentCount(),
      metaCollection.findOne({ _id: 'current' }),
    ]);

    if (storedCount > 0) {
      return NextResponse.json(
        {
          source: 'upstream',
          updatedAt: new Date().toISOString(),
          syncedAt: toDate(meta?.syncedAt)?.toISOString() ?? null,
          totalCount: typeof meta?.totalCount === 'number' ? meta.totalCount : storedCount,
          matchedCount: typeof meta?.matchedCount === 'number' ? meta.matchedCount : storedCount,
          storedCount,
          warnings: [],
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'upstream' } }
      );
    }

    if (!esntlId || !authKey) {
      return NextResponse.json(
        {
          source: 'mock',
          updatedAt: new Date().toISOString(),
          storedCount: 0,
          totalCount: 0,
          matchedCount: 0,
          warnings: ['Missing env: TEAM2_SAFE182_ESNTL_ID or TEAM2_SAFE182_AUTH_KEY'],
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
      );
    }

    try {
      const probe = await fetchSourceProbe(esntlId, authKey);
      return NextResponse.json(
        {
          source: 'upstream',
          updatedAt: new Date().toISOString(),
          storedCount: 0,
          totalCount: probe.totalCount,
          matchedCount: 0,
          warnings: [],
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'upstream' } }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          source: 'mock',
          updatedAt: new Date().toISOString(),
          storedCount: 0,
          totalCount: 0,
          matchedCount: 0,
          warnings: [`safe182 source probe failed: ${message}`],
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
      );
    }
  }

  const runtimeWarnings: string[] = [];

  const [storedCountBefore, metaBefore] = await Promise.all([
    collection.estimatedDocumentCount(),
    metaCollection.findOne({ _id: 'current' }),
  ]);

  const lastSyncedAt = toDate(metaBefore?.syncedAt);
  const shouldSync =
    refresh
    || storedCountBefore === 0
    || !lastSyncedAt
    || (Date.now() - lastSyncedAt.getTime() > syncTtlMs);

  if (shouldSync) {
    if (esntlId && authKey) {
      try {
        const syncResult = await runSyncWithLock({
          esntlId,
          authKey,
          rowSize,
          maxPages,
          collection,
          metaCollection,
          dongCollection,
        });
        runtimeWarnings.push(...syncResult.warnings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeWarnings.push(`safe182 sync failed: ${message}`);
      }
    } else {
      runtimeWarnings.push('Missing env: TEAM2_SAFE182_ESNTL_ID or TEAM2_SAFE182_AUTH_KEY');
    }
  }

  const querySummary = await queryMissingLocations({
    collection,
    metaCollection,
    maxFeatures,
    bbox,
  });

  const warnings = uniqueWarnings([...querySummary.warnings, ...runtimeWarnings]);

  if (querySummary.source === 'mock' && !esntlId && !authKey && warnings.length === 0) {
    warnings.push('Missing env: TEAM2_SAFE182_ESNTL_ID or TEAM2_SAFE182_AUTH_KEY');
  }

  if (querySummary.source === 'mock') {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        syncedAt: querySummary.syncedAt,
        data: emptyFeatureCollection(),
        totalCount: querySummary.totalCount,
        matchedCount: querySummary.matchedCount,
        storedCount: querySummary.storedCount,
        warnings,
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  return NextResponse.json(
    {
      source: 'upstream',
      updatedAt: new Date().toISOString(),
      syncedAt: querySummary.syncedAt,
      data: {
        type: 'FeatureCollection',
        features: querySummary.features,
      } satisfies GeoJSON.FeatureCollection,
      totalCount: querySummary.totalCount,
      matchedCount: querySummary.matchedCount,
      storedCount: querySummary.storedCount,
      warnings,
    },
    { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'upstream' } }
  );
}
