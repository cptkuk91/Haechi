import { NextResponse } from 'next/server';
import type { Collection, Document } from 'mongodb';
import clientPromise from '@/lib/mongodb';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { clampInt, compactText, toNumber, toPositiveInt } from '@/app/api/_shared/parse-primitives';
import { extractResultWarningFromXml, extractXmlItems, extractXmlTagValue } from '@/app/api/_shared/xml-utils';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B554287/DisabledPersonConvenientFacility/getDisConvFaclList';
const DEFAULT_COLLECTION_NAME = 'vulnerable_disabled_facilities';
const DEFAULT_PAGE_SIZE = 500;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 60;
const DEFAULT_MAX_FEATURES = 2000;
const MIN_MAX_FEATURES = 1;
const MAX_MAX_FEATURES = 20_000;
const DEFAULT_FACILITY_TYPE = '장애인복지시설';
const DEFAULT_SYNC_TTL_MINUTES = 360;
const MIN_SYNC_TTL_MINUTES = 10;
const MAX_SYNC_TTL_MINUTES = 1440;
const SUCCESS_CODES = new Set(['0', '00', 'SUCCESS', 'NORMAL_SERVICE']);

interface DisabledFacilityRow {
  estbDate: string | null;
  faclInfId: string | null;
  faclLat: string | null;
  faclLng: string | null;
  faclNm: string | null;
  faclTyCd: string | null;
  lcMnad: string | null;
  salStaDivCd: string | null;
  salStaNm: string | null;
  wfcltDivCd: string | null;
  wfcltId: string | null;
}

interface PageFetchResult {
  rows: DisabledFacilityRow[];
  warning?: string;
  resultCode?: string | null;
}

interface DongCoordinate {
  fullAddress: string;
  sidoName: string;
  sigunguName: string;
  lat: number | null;
  lng: number | null;
}

interface Coordinate {
  lat: number;
  lng: number;
}

interface CoordinateMaps {
  exactMap: Map<string, Coordinate>;
  sigunguMap: Map<string, Coordinate>;
}

interface ParsedAddress {
  sido: string;
  sigunguCandidates: string[];
  detailCandidates: string[];
}

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface DisabledFacilityDocument extends Document {
  sourceId: string;
  wfcltId: string | null;
  faclInfId: string | null;
  name: string;
  facilityType: string;
  address: string | null;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  coordSource: 'api' | 'address-mapped';
  openYn: string | null;
  statusName: string | null;
  estbDate: string | null;
  syncedAt: Date;
  updatedAt: Date;
}

interface SyncSummary {
  source: 'mock' | 'upstream';
  storedCount: number;
  warnings: string[];
}

interface QueryResult {
  source: 'mock' | 'upstream';
  storedCount: number;
  features: GeoJSON.Feature<GeoJSON.Point>[];
  syncedAt: string | null;
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
  전북: '전북특별자치도',
  전남: '전라남도',
  경북: '경상북도',
  경남: '경상남도',
  제주: '제주특별자치도',
  강원도: '강원특별자치도',
  전라북도: '전북특별자치도',
};

const SIGUNGU_ALIAS: Record<string, { sido: string; sigungu: string }> = {
  '경상남도 진해시': { sido: '경상남도', sigungu: '창원시 진해구' },
  '경상북도 군위군': { sido: '대구광역시', sigungu: '군위군' },
};

let ensureIndexesPromise: Promise<void> | null = null;
let syncInFlight: Promise<SyncSummary> | null = null;

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
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

function normalizeSido(value: string): string {
  const cleaned = compactText(value);
  return SIDO_ALIAS[cleaned] ?? cleaned;
}

function parseAddress(addressRaw: string): ParsedAddress | null {
  const cleaned = compactText(addressRaw);
  if (!cleaned) return null;

  const parts = cleaned.split(/\s+/);
  if (parts.length < 2) return null;

  const sido = normalizeSido(parts[0]);
  const sigunguCandidates = new Set<string>();

  const second = compactText(parts[1]);
  if (second) sigunguCandidates.add(second);

  const third = parts[2] ? compactText(parts[2]) : '';
  const useCombinedSigungu = second && third && /[시군구]$/.test(second) && /[시군구]$/.test(third);
  if (useCombinedSigungu) {
    sigunguCandidates.add(`${second} ${third}`);
  }

  const detailStart = useCombinedSigungu ? 3 : 2;
  const detailCandidates = new Set<string>();

  for (let i = detailStart; i < parts.length; i += 1) {
    const token = compactText(parts[i]);
    if (!token) continue;
    if (/[동읍면리]$/.test(token)) {
      detailCandidates.add(token);
    }
  }

  const firstDetail = parts[detailStart] ? compactText(parts[detailStart]) : '';
  if (firstDetail) {
    detailCandidates.add(firstDetail);
    if (!/[동읍면리]$/.test(firstDetail)) {
      detailCandidates.add(`${firstDetail}동`);
      detailCandidates.add(`${firstDetail}읍`);
      detailCandidates.add(`${firstDetail}면`);
      detailCandidates.add(`${firstDetail}리`);
    }
  }

  return {
    sido,
    sigunguCandidates: [...sigunguCandidates].filter(Boolean),
    detailCandidates: [...detailCandidates].filter(Boolean),
  };
}

function pickAddressCoordinate(addressRaw: string, maps: CoordinateMaps): Coordinate | null {
  const parsed = parseAddress(addressRaw);
  if (!parsed) return null;

  const aliasEntries = [...parsed.sigunguCandidates]
    .map((sigungu) => SIGUNGU_ALIAS[`${parsed.sido} ${sigungu}`])
    .filter(Boolean) as Array<{ sido: string; sigungu: string }>;

  const sigunguCandidates = new Set<string>(parsed.sigunguCandidates);
  for (const alias of aliasEntries) {
    sigunguCandidates.add(alias.sigungu);
  }

  for (const sigungu of sigunguCandidates) {
    for (const detail of parsed.detailCandidates) {
      const full = `${parsed.sido} ${sigungu} ${detail}`;
      const coord = maps.exactMap.get(full);
      if (coord) return coord;
    }

    const sigunguKey = `${parsed.sido} ${sigungu}`;
    const sigunguCoord = maps.sigunguMap.get(sigunguKey);
    if (sigunguCoord) return sigunguCoord;

    const coarse = sigungu.split(/\s+/)[0] ?? sigungu;
    const coarseKey = `${parsed.sido} ${coarse}`;
    const coarseCoord = maps.sigunguMap.get(coarseKey);
    if (coarseCoord) return coarseCoord;
  }

  return null;
}

async function buildCoordMaps(collection: Collection<Document>): Promise<CoordinateMaps> {
  const docs = await collection
    .find({ lat: { $ne: null }, lng: { $ne: null } })
    .project<DongCoordinate>({ fullAddress: 1, sidoName: 1, sigunguName: 1, lat: 1, lng: 1 })
    .toArray();

  const exactMap = new Map<string, Coordinate>();
  const sigunguMap = new Map<string, Coordinate>();

  for (const doc of docs) {
    if (doc.lat == null || doc.lng == null) continue;

    exactMap.set(doc.fullAddress, { lat: doc.lat, lng: doc.lng });

    const fullKey = `${doc.sidoName} ${doc.sigunguName}`;
    if (!sigunguMap.has(fullKey)) {
      sigunguMap.set(fullKey, { lat: doc.lat, lng: doc.lng });
    }

    const coarse = doc.sigunguName.split(/\s+/)[0] ?? doc.sigunguName;
    const coarseKey = `${doc.sidoName} ${coarse}`;
    if (!sigunguMap.has(coarseKey)) {
      sigunguMap.set(coarseKey, { lat: doc.lat, lng: doc.lng });
    }
  }

  return { exactMap, sigunguMap };
}

function extractRowsFromXml(xml: string): DisabledFacilityRow[] {
  const items = extractXmlItems(xml, 'servList');
  const rows: DisabledFacilityRow[] = [];

  for (const item of items) {
    rows.push({
      estbDate: extractXmlTagValue(item, 'estbDate', { decodeEntities: true, compactWhitespace: true }),
      faclInfId: extractXmlTagValue(item, 'faclInfId', { decodeEntities: true, compactWhitespace: true }),
      faclLat: extractXmlTagValue(item, 'faclLat', { decodeEntities: true, compactWhitespace: true }),
      faclLng: extractXmlTagValue(item, 'faclLng', { decodeEntities: true, compactWhitespace: true }),
      faclNm: extractXmlTagValue(item, 'faclNm', { decodeEntities: true, compactWhitespace: true }),
      faclTyCd: extractXmlTagValue(item, 'faclTyCd', { decodeEntities: true, compactWhitespace: true }),
      lcMnad: extractXmlTagValue(item, 'lcMnad', { decodeEntities: true, compactWhitespace: true }),
      salStaDivCd: extractXmlTagValue(item, 'salStaDivCd', { decodeEntities: true, compactWhitespace: true }),
      salStaNm: extractXmlTagValue(item, 'salStaNm', { decodeEntities: true, compactWhitespace: true }),
      wfcltDivCd: extractXmlTagValue(item, 'wfcltDivCd', { decodeEntities: true, compactWhitespace: true }),
      wfcltId: extractXmlTagValue(item, 'wfcltId', { decodeEntities: true, compactWhitespace: true }),
    });
  }

  return rows;
}

async function fetchDisabledFacilityPage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
  pageSize: number;
  facilityType: string | null;
}): Promise<PageFetchResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));
  if (args.facilityType) {
    url.searchParams.set('faclTyCd', args.facilityType);
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
      warning: `Disabled facility upstream responded ${response.status}`,
    };
  }

  const xml = await response.text();
  if (!xml.trim()) {
    return {
      rows: [],
      warning: 'Disabled facility upstream returned empty body',
    };
  }

  const warning = extractResultWarningFromXml(xml, {
    sourceLabel: 'Disabled facility API',
    codeTag: 'resultCode',
    messageTag: 'resultMessage',
    successCodes: SUCCESS_CODES,
    decodeEntities: true,
    compactWhitespace: true,
  }) ?? undefined;

  return {
    rows: extractRowsFromXml(xml),
    warning,
    resultCode: extractXmlTagValue(xml, 'resultCode', { decodeEntities: true, compactWhitespace: true }),
  };
}

function makeSourceId(row: DisabledFacilityRow): string {
  const wfcltId = compactText(row.wfcltId ?? '');
  if (wfcltId) return wfcltId;

  const faclInfId = compactText(row.faclInfId ?? '');
  if (faclInfId) return faclInfId;

  const base = [
    compactText(row.faclNm ?? ''),
    compactText(row.lcMnad ?? ''),
    compactText(row.estbDate ?? ''),
    compactText(row.faclTyCd ?? ''),
  ]
    .filter(Boolean)
    .join('|');

  if (base) {
    const encoded = Buffer.from(base).toString('base64url').slice(0, 48);
    if (encoded) return `AUTO-${encoded}`;
  }

  return `AUTO-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toFeatureId(sourceId: string): string {
  const normalized = sourceId.replace(/[^a-zA-Z0-9\uac00-\ud7a3_-]+/g, '-');
  return `disabled-facility-${normalized}`;
}

async function ensureDisabledFacilityIndexes(collection: Collection<DisabledFacilityDocument>): Promise<void> {
  if (!ensureIndexesPromise) {
    ensureIndexesPromise = (async () => {
      await collection.createIndex({ sourceId: 1 }, { unique: true });
      await collection.createIndex({ location: '2dsphere' });
      await collection.createIndex({ syncedAt: -1 });
    })().catch((error) => {
      ensureIndexesPromise = null;
      throw error;
    });
  }

  await ensureIndexesPromise;
}

async function getLatestSyncedAt(collection: Collection<DisabledFacilityDocument>): Promise<Date | null> {
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
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function synchronizeDisabledFacilities(args: {
  collection: Collection<DisabledFacilityDocument>;
  dongCollection: Collection<Document>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
  facilityType: string | null;
  onlyOpen: boolean;
}): Promise<SyncSummary> {
  const warnings: string[] = [];
  const docsById = new Map<string, DisabledFacilityDocument>();

  let coordMaps: CoordinateMaps | null = null;
  let coordMapLoadFailed = false;
  let fallbackMappedCount = 0;
  let fallbackMissingCount = 0;
  let invalidCoordinateCount = 0;

  for (let pageNo = 1; pageNo <= args.maxPages; pageNo += 1) {
    const page = await fetchDisabledFacilityPage({
      upstreamUrl: args.upstreamUrl,
      apiKey: args.apiKey,
      pageNo,
      pageSize: args.pageSize,
      facilityType: args.facilityType,
    });

    if (page.warning) warnings.push(page.warning);
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      if (args.onlyOpen && row.salStaDivCd && row.salStaDivCd.toUpperCase() !== 'Y') {
        continue;
      }

      const latRaw = toNumber(row.faclLat);
      const lngRaw = toNumber(row.faclLng);

      let lat: number | null = null;
      let lng: number | null = null;
      let coordSource: 'api' | 'address-mapped' = 'api';

      if (
        latRaw !== null
        && lngRaw !== null
        && latRaw !== 0
        && lngRaw !== 0
        && latRaw >= -90
        && latRaw <= 90
        && lngRaw >= -180
        && lngRaw <= 180
      ) {
        lat = latRaw;
        lng = lngRaw;
      } else if (row.lcMnad) {
        try {
          if (!coordMaps && !coordMapLoadFailed) {
            coordMaps = await buildCoordMaps(args.dongCollection);
          }
        } catch {
          coordMapLoadFailed = true;
        }

        if (coordMaps) {
          const resolved = pickAddressCoordinate(row.lcMnad, coordMaps);
          if (resolved) {
            lat = resolved.lat;
            lng = resolved.lng;
            coordSource = 'address-mapped';
            fallbackMappedCount += 1;
          } else {
            fallbackMissingCount += 1;
          }
        } else {
          fallbackMissingCount += 1;
        }
      } else {
        invalidCoordinateCount += 1;
      }

      if (lat === null || lng === null) continue;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

      const sourceId = makeSourceId(row);
      const syncedAt = new Date();
      const openYnRaw = compactText(row.salStaDivCd ?? '').toUpperCase();

      docsById.set(sourceId, {
        sourceId,
        wfcltId: compactText(row.wfcltId ?? '') || null,
        faclInfId: compactText(row.faclInfId ?? '') || null,
        name: compactText(row.faclNm ?? '') || '장애인 편의시설',
        facilityType: compactText(row.faclTyCd ?? '') || '장애인편의시설',
        address: compactText(row.lcMnad ?? '') || null,
        location: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        coordSource,
        openYn: openYnRaw || null,
        statusName: compactText(row.salStaNm ?? '') || null,
        estbDate: compactText(row.estbDate ?? '') || null,
        syncedAt,
        updatedAt: syncedAt,
      });

      if (docsById.size >= args.maxFeatures) break;
    }

    if (docsById.size >= args.maxFeatures) break;
    if (page.rows.length < args.pageSize) break;
  }

  if (coordMapLoadFailed) {
    warnings.push('Address fallback disabled: failed to load dong_coordinates');
  }
  if (fallbackMappedCount > 0) {
    warnings.push(`Address fallback mapped ${fallbackMappedCount} facilities`);
  }
  if (fallbackMissingCount > 0) {
    warnings.push(`Address fallback failed for ${fallbackMissingCount} facilities`);
  }
  if (invalidCoordinateCount > 0) {
    warnings.push(`Skipped ${invalidCoordinateCount} facilities with invalid coordinates`);
  }

  const sourceIds = [...docsById.keys()];
  const operations = sourceIds.map((sourceId) => {
    const doc = docsById.get(sourceId)!;
    return {
      updateOne: {
        filter: { sourceId },
        update: {
          $set: doc,
        },
        upsert: true,
      },
    };
  });

  for (const chunk of chunkArray(operations, 1000)) {
    if (chunk.length > 0) {
      await args.collection.bulkWrite(chunk, { ordered: false });
    }
  }

  if (sourceIds.length === 0) {
    await args.collection.deleteMany({});
  } else {
    await args.collection.deleteMany({ sourceId: { $nin: sourceIds } });
  }

  return {
    source: sourceIds.length > 0 ? 'upstream' : 'mock',
    storedCount: sourceIds.length,
    warnings,
  };
}

async function runSyncWithLock(args: {
  collection: Collection<DisabledFacilityDocument>;
  dongCollection: Collection<Document>;
  upstreamUrl: string;
  apiKey: string;
  pageSize: number;
  maxPages: number;
  maxFeatures: number;
  facilityType: string | null;
  onlyOpen: boolean;
}): Promise<SyncSummary> {
  if (!syncInFlight) {
    syncInFlight = synchronizeDisabledFacilities(args).finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}

async function queryFacilitiesFromCollection(args: {
  collection: Collection<DisabledFacilityDocument>;
  bbox: Bbox | null;
  maxFeatures: number;
  onlyOpen: boolean;
}): Promise<QueryResult> {
  const filter: Document = {};

  if (args.onlyOpen) {
    filter.openYn = 'Y';
  }

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

  const [totalStoredCount, latestSyncedAt, docs] = await Promise.all([
    args.collection.estimatedDocumentCount(),
    getLatestSyncedAt(args.collection),
    args.collection
      .find(filter)
      .project<DisabledFacilityDocument>({
        sourceId: 1,
        wfcltId: 1,
        faclInfId: 1,
        name: 1,
        facilityType: 1,
        address: 1,
        location: 1,
        coordSource: 1,
        statusName: 1,
        estbDate: 1,
      })
      .limit(args.maxFeatures)
      .toArray(),
  ]);

  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (const doc of docs) {
    const coordinates = doc.location?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;

    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const featureId = toFeatureId(doc.sourceId);

    features.push({
      type: 'Feature',
      id: featureId,
      geometry: {
        type: 'Point',
        coordinates: [lng, lat],
      },
      properties: {
        id: featureId,
        name: doc.name,
        category: doc.facilityType,
        facilityType: doc.facilityType,
        address: doc.address,
        status: doc.statusName,
        estbDate: doc.estbDate,
        wfcltId: doc.wfcltId,
        faclInfId: doc.faclInfId,
        coordSource: doc.coordSource,
        source: 'disabled-facility-db',
      },
    });
  }

  return {
    source: totalStoredCount > 0 ? 'upstream' : 'mock',
    storedCount: totalStoredCount,
    features,
    syncedAt: latestSyncedAt ? latestSyncedAt.toISOString() : null,
  };
}

export async function GET(request: Request) {
  const key = process.env.TEAM2_DISABLED_FACILITY_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  const searchParams = new URL(request.url).searchParams;
  const sourceOnlyRaw = (searchParams.get('sourceOnly') ?? '').trim().toLowerCase();
  const sourceOnly = sourceOnlyRaw === '1' || sourceOnlyRaw === 'true' || sourceOnlyRaw === 'yes';
  const forceSyncRaw = (searchParams.get('refresh') ?? '').trim().toLowerCase();
  const forceSync = forceSyncRaw === '1' || forceSyncRaw === 'true' || forceSyncRaw === 'yes';

  const collectionName = compactText(process.env.TEAM2_DISABLED_FACILITY_COLLECTION ?? DEFAULT_COLLECTION_NAME)
    || DEFAULT_COLLECTION_NAME;

  const upstreamUrl = process.env.TEAM2_DISABLED_FACILITY_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(process.env.TEAM2_DISABLED_FACILITY_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(process.env.TEAM2_DISABLED_FACILITY_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );
  const defaultMaxFeatures = clampInt(
    toPositiveInt(process.env.TEAM2_DISABLED_FACILITY_MAX_FEATURES, DEFAULT_MAX_FEATURES),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );
  const requestMaxRaw = searchParams.get('max');
  const maxFeatures = clampInt(
    toPositiveInt(requestMaxRaw, defaultMaxFeatures),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );

  const facilityTypeRaw = compactText(process.env.TEAM2_DISABLED_FACILITY_TYPE ?? DEFAULT_FACILITY_TYPE);
  const facilityType = facilityTypeRaw ? facilityTypeRaw : null;
  const onlyOpen = parseBoolean(process.env.TEAM2_DISABLED_FACILITY_ONLY_OPEN, true);
  const syncTtlMinutes = clampInt(
    toPositiveInt(process.env.TEAM2_DISABLED_FACILITY_SYNC_TTL_MINUTES, DEFAULT_SYNC_TTL_MINUTES),
    MIN_SYNC_TTL_MINUTES,
    MAX_SYNC_TTL_MINUTES
  );
  const syncTtlMs = syncTtlMinutes * 60_000;
  const bbox = parseBboxQueryParam(searchParams.get('bbox'));

  const client = await clientPromise;
  const db = client.db('haechi');
  const facilityCollection = db.collection<DisabledFacilityDocument>(collectionName);
  const dongCollection = db.collection<Document>('dong_coordinates');

  await ensureDisabledFacilityIndexes(facilityCollection);

  if (sourceOnly) {
    const [storedCount, latestSyncedAt] = await Promise.all([
      facilityCollection.estimatedDocumentCount(),
      getLatestSyncedAt(facilityCollection),
    ]);

    if (storedCount > 0) {
      return NextResponse.json(
        {
          source: 'upstream',
          updatedAt: new Date().toISOString(),
          syncedAt: latestSyncedAt ? latestSyncedAt.toISOString() : null,
          storedCount,
          warnings: key ? [] : ['Missing env: TEAM2_DISABLED_FACILITY_API_KEY (using stored collection only)'],
        },
        {
          headers: {
            'cache-control': 'no-store, max-age=0',
            'x-team2-source': 'upstream',
          },
        }
      );
    }

    if (!key) {
      return NextResponse.json(
        {
          source: 'mock',
          updatedAt: new Date().toISOString(),
          storedCount: 0,
          warnings: ['Missing env: TEAM2_DISABLED_FACILITY_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY)'],
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
      const probe = await fetchDisabledFacilityPage({
        upstreamUrl,
        apiKey: key,
        pageNo: 1,
        pageSize: 1,
        facilityType,
      });

      if (probe.warning) {
        return NextResponse.json(
          {
            source: 'mock',
            updatedAt: new Date().toISOString(),
            storedCount: 0,
            warnings: [probe.warning],
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
          storedCount: 0,
          warnings: [],
        },
        {
          headers: {
            'cache-control': 'no-store, max-age=0',
            'x-team2-source': 'upstream',
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
          warnings: [`Disabled facility source probe failed: ${message}`],
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

  const warnings: string[] = [];

  let latestSyncedAt = await getLatestSyncedAt(facilityCollection);
  let storedCount = await facilityCollection.estimatedDocumentCount();

  const shouldSync =
    forceSync
    || storedCount === 0
    || !latestSyncedAt
    || (Date.now() - latestSyncedAt.getTime() > syncTtlMs);

  if (shouldSync && key) {
    try {
      const syncResult = await runSyncWithLock({
        collection: facilityCollection,
        dongCollection,
        upstreamUrl,
        apiKey: key,
        pageSize,
        maxPages,
        maxFeatures: defaultMaxFeatures,
        facilityType,
        onlyOpen,
      });
      warnings.push(...syncResult.warnings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Disabled facility sync failed: ${message}`);
    }

    latestSyncedAt = await getLatestSyncedAt(facilityCollection);
    storedCount = await facilityCollection.estimatedDocumentCount();
  } else if (shouldSync && !key) {
    warnings.push('Missing env: TEAM2_DISABLED_FACILITY_API_KEY (using stored collection only)');
  }

  const queryResult = await queryFacilitiesFromCollection({
    collection: facilityCollection,
    bbox,
    maxFeatures,
    onlyOpen,
  });

  const source = queryResult.source;

  if (source === 'mock' && !key && warnings.length === 0) {
    warnings.push('Missing env: TEAM2_DISABLED_FACILITY_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY)');
  }

  return NextResponse.json(
    {
      source,
      updatedAt: new Date().toISOString(),
      syncedAt: queryResult.syncedAt ?? (latestSyncedAt ? latestSyncedAt.toISOString() : null),
      storedCount: queryResult.storedCount,
      data: {
        type: 'FeatureCollection',
        features: queryResult.features,
      } satisfies GeoJSON.FeatureCollection,
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
