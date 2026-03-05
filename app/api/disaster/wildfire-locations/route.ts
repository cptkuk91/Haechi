import { NextResponse } from 'next/server';
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
  toNumber,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  extractResultWarningFromXml as extractResultWarningFromXmlShared,
  extractXmlItems,
  extractXmlTagValue,
} from '@/app/api/_shared/xml-utils';

const DEFAULT_UPSTREAM_URL = 'http://apis.data.go.kr/1400000/forestStusService/getfirestatsservice';
const DEFAULT_PAGE_SIZE = 500;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;
const MIN_MAX_PAGES = 1;
const MAX_MAX_PAGES = 50;
const CACHE_TTL_MS = 6 * 60 * 60_000;

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

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

interface DongCoordinate {
  fullAddress: string;
  sidoName: string;
  sigunguName: string;
  lat: number | null;
  lng: number | null;
}

interface CachedResult {
  json: Record<string, unknown>;
  source: 'mock' | 'upstream';
  cachedAt: number;
}

interface Coordinate {
  lat: number;
  lng: number;
}

interface CoordinateMaps {
  exactMap: Map<string, Coordinate>;
  sigunguMap: Map<string, Coordinate>;
}

interface WildfirePeriod {
  start: string;
  end: string;
}

let cache = new Map<string, CachedResult>();

function normalizeYmd(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  return digits;
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function resolvePeriod(searchParams: URLSearchParams): WildfirePeriod {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(now.getFullYear() - 1);

  const fallbackStart = formatYmd(oneYearAgo);
  const fallbackEnd = formatYmd(now);

  const start = normalizeYmd(searchParams.get('searchStDt')) ?? fallbackStart;
  const end = normalizeYmd(searchParams.get('searchEdDt')) ?? fallbackEnd;

  if (start <= end) return { start, end };
  return { start: end, end: start };
}

function readWildfireXmlTag(source: string, tag: string): string | null {
  return extractXmlTagValue(source, tag, {
    decodeEntities: true,
    compactWhitespace: true,
  });
}

function extractRowsFromXml(xml: string): JsonRecord[] {
  const matches = extractXmlItems(xml, 'item');
  const rows: JsonRecord[] = [];

  for (const itemXml of matches) {
    rows.push({
      damagearea: readWildfireXmlTag(itemXml, 'damagearea'),
      endday: readWildfireXmlTag(itemXml, 'endday'),
      endmonth: readWildfireXmlTag(itemXml, 'endmonth'),
      endtime: readWildfireXmlTag(itemXml, 'endtime'),
      endyear: readWildfireXmlTag(itemXml, 'endyear'),
      firecause: readWildfireXmlTag(itemXml, 'firecause'),
      locbunji: readWildfireXmlTag(itemXml, 'locbunji'),
      locdong: readWildfireXmlTag(itemXml, 'locdong'),
      locgungu: readWildfireXmlTag(itemXml, 'locgungu'),
      locmenu: readWildfireXmlTag(itemXml, 'locmenu'),
      locsi: readWildfireXmlTag(itemXml, 'locsi'),
      startday: readWildfireXmlTag(itemXml, 'startday'),
      startdayofweek: readWildfireXmlTag(itemXml, 'startdayofweek'),
      startmonth: readWildfireXmlTag(itemXml, 'startmonth'),
      starttime: readWildfireXmlTag(itemXml, 'starttime'),
      startyear: readWildfireXmlTag(itemXml, 'startyear'),
    });
  }

  return rows;
}

function extractResultWarningFromXml(xml: string): string | null {
  return extractResultWarningFromXmlShared(xml, {
    sourceLabel: 'forest wildfire API',
    decodeEntities: true,
    compactWhitespace: true,
  });
}

async function fetchWildfirePage(args: {
  upstreamUrl: string;
  apiKey: string;
  pageNo: number;
  pageSize: number;
  period: WildfirePeriod;
}): Promise<PageFetchResult> {
  const url = new URL(args.upstreamUrl);
  if (!url.searchParams.has('ServiceKey') && !url.searchParams.has('serviceKey')) {
    url.searchParams.set('ServiceKey', args.apiKey);
  }
  url.searchParams.set('numOfRows', String(args.pageSize));
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('searchStDt', args.period.start);
  url.searchParams.set('searchEdDt', args.period.end);
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
      warning: `forest wildfire upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'forest wildfire upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    const warning = extractResultWarningFromCommonJson(json, 'forest wildfire API') ?? undefined;
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json),
      warning,
    };
  } catch {
    const warning = extractResultWarningFromXml(text) ?? undefined;
    return {
      rows: extractRowsFromXml(text),
      totalCount: toPositiveInt(readWildfireXmlTag(text, 'totalCount'), 0) || null,
      warning,
    };
  }
}

async function buildCoordMaps(): Promise<CoordinateMaps> {
  const client = await clientPromise;
  const collection = client.db('haechi').collection<DongCoordinate>('dong_coordinates');
  const docs = await collection
    .find({ lat: { $ne: null }, lng: { $ne: null } })
    .project({ fullAddress: 1, sidoName: 1, sigunguName: 1, lat: 1, lng: 1 })
    .toArray();

  const exactMap = new Map<string, Coordinate>();
  const sigunguMap = new Map<string, Coordinate>();

  for (const doc of docs) {
    if (doc.lat == null || doc.lng == null) continue;

    exactMap.set(doc.fullAddress, { lat: doc.lat, lng: doc.lng });

    const key = `${doc.sidoName} ${doc.sigunguName}`;
    if (!sigunguMap.has(key)) {
      sigunguMap.set(key, { lat: doc.lat, lng: doc.lng });
    }

    const head = doc.sigunguName.split(/\s+/)[0] ?? doc.sigunguName;
    const coarseKey = `${doc.sidoName} ${head}`;
    if (!sigunguMap.has(coarseKey)) {
      sigunguMap.set(coarseKey, { lat: doc.lat, lng: doc.lng });
    }
  }

  return { exactMap, sigunguMap };
}

function normalizeSido(raw: string): string {
  return SIDO_ALIAS[raw] ?? raw;
}

function buildSigunguCandidates(sigunguRaw: string): string[] {
  const cleaned = compactText(sigunguRaw);
  if (!cleaned) return [];

  const set = new Set<string>([cleaned]);
  if (!/[시군구]$/.test(cleaned)) {
    set.add(`${cleaned}시`);
    set.add(`${cleaned}군`);
    set.add(`${cleaned}구`);
  }
  return [...set];
}

function buildDetailCandidates(menu: string | null, dong: string | null): string[] {
  const set = new Set<string>();

  const addWithSuffix = (base: string, suffixes: string[]) => {
    const cleaned = compactText(base);
    if (!cleaned) return;
    set.add(cleaned);
    if (!/[읍면동리가]$/.test(cleaned)) {
      for (const suffix of suffixes) {
        set.add(`${cleaned}${suffix}`);
      }
    }
  };

  if (menu) {
    addWithSuffix(menu, ['면', '읍', '동']);
  }
  if (dong) {
    addWithSuffix(dong, ['리', '동']);
  }

  if (menu && dong) {
    const menuCandidates = [...set].filter((value) => value.startsWith(menu));
    const dongCandidates = [dong, `${dong}리`, `${dong}동`];
    for (const menuCandidate of menuCandidates) {
      for (const dongCandidate of dongCandidates) {
        set.add(`${menuCandidate}${dongCandidate}`);
      }
    }
  }

  return [...set].filter(Boolean);
}

function resolveRowCoordinate(
  row: JsonRecord,
  maps: CoordinateMaps
): { key: string; coord: Coordinate } | null {
  const sidoRaw = pickString(row, ['locsi', 'locSi']);
  const sigunguRaw = pickString(row, ['locgungu', 'locGungu']);

  if (!sidoRaw || !sigunguRaw) return null;

  const sido = normalizeSido(sidoRaw);
  const sigunguCandidates = buildSigunguCandidates(sigunguRaw);
  const menu = pickString(row, ['locmenu', 'locMenu']);
  const dong = pickString(row, ['locdong', 'locDong']);
  const detailCandidates = buildDetailCandidates(menu, dong);

  for (const sigungu of sigunguCandidates) {
    for (const detail of detailCandidates) {
      const fullKey = `${sido} ${sigungu} ${detail}`;
      const coord = maps.exactMap.get(fullKey);
      if (coord) return { key: fullKey, coord };
    }

    const sigunguKey = `${sido} ${sigungu}`;
    const sigunguCoord = maps.sigunguMap.get(sigunguKey);
    if (sigunguCoord) return { key: sigunguKey, coord: sigunguCoord };
  }

  const alias = SIGUNGU_ALIAS[`${sido} ${sigunguRaw}`];
  if (alias) {
    const aliasKey = `${alias.sido} ${alias.sigungu}`;
    const coord = maps.sigunguMap.get(aliasKey);
    if (coord) return { key: aliasKey, coord };
  }

  return null;
}

function normalizeTimeToken(value: string | null): string {
  if (!value) return '00:00:00';

  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;

  const digits = value.replace(/\D/g, '');
  if (digits.length >= 6) {
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
  }
  return '00:00:00';
}

function composeStartAt(row: JsonRecord): string | null {
  const year = pickString(row, ['startyear', 'startYear']);
  const month = pickString(row, ['startmonth', 'startMonth']);
  const day = pickString(row, ['startday', 'startDay']);
  const time = normalizeTimeToken(pickString(row, ['starttime', 'startTime']));

  if (!year || !month || !day) return null;

  const yyyy = year.padStart(4, '0');
  const mm = month.padStart(2, '0');
  const dd = day.padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${time}`;
}

async function buildResult(args: {
  apiKey: string;
  upstreamUrl: string;
  period: WildfirePeriod;
  pageSize: number;
  maxPages: number;
}): Promise<{ json: Record<string, unknown>; source: 'mock' | 'upstream' }> {
  const warnings: string[] = [];
  const rows: JsonRecord[] = [];

  let totalPages = 1;
  for (let pageNo = 1; pageNo <= totalPages && pageNo <= args.maxPages; pageNo += 1) {
    const page = await fetchWildfirePage({
      upstreamUrl: args.upstreamUrl,
      apiKey: args.apiKey,
      pageNo,
      pageSize: args.pageSize,
      period: args.period,
    });

    if (page.warning) warnings.push(page.warning);
    rows.push(...page.rows);

    if (page.totalCount && page.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(page.totalCount / args.pageSize));
    } else if (page.rows.length < args.pageSize) {
      break;
    }
  }

  const maps = await buildCoordMaps();

  const locationCounts = new Map<
    string,
    {
      lat: number;
      lng: number;
      count: number;
      address: string;
      latestStartAt: string | null;
      maxDamageArea: number | null;
      cause: string | null;
    }
  >();

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const row of rows) {
    const matched = resolveRowCoordinate(row, maps);
    if (!matched) {
      unmatchedCount += 1;
      continue;
    }

    matchedCount += 1;

    const startAt = composeStartAt(row);
    const damageArea = pickNumber(row, ['damagearea', 'damageArea']);
    const fireCause = pickString(row, ['firecause', 'fireCause']);

    const existing = locationCounts.get(matched.key);
    if (!existing) {
      locationCounts.set(matched.key, {
        lat: matched.coord.lat,
        lng: matched.coord.lng,
        count: 1,
        address: matched.key,
        latestStartAt: startAt,
        maxDamageArea: damageArea,
        cause: fireCause,
      });
      continue;
    }

    existing.count += 1;

    if (startAt && (!existing.latestStartAt || startAt > existing.latestStartAt)) {
      existing.latestStartAt = startAt;
    }

    if (damageArea !== null && (existing.maxDamageArea === null || damageArea > existing.maxDamageArea)) {
      existing.maxDamageArea = damageArea;
    }

    if (!existing.cause && fireCause) {
      existing.cause = fireCause;
    }
  }

  if (unmatchedCount > 0) {
    warnings.push(`${unmatchedCount}건의 산불 데이터를 dong_coordinates와 매칭하지 못했습니다.`);
  }

  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  let index = 0;

  for (const [, loc] of locationCounts) {
    index += 1;
    features.push({
      type: 'Feature',
      id: `wildfire-${index}`,
      geometry: {
        type: 'Point',
        coordinates: [loc.lng, loc.lat],
      },
      properties: {
        id: `wildfire-${index}`,
        name: '산불 발생 지점',
        address: loc.address,
        count: loc.count,
        latestStartAt: loc.latestStartAt,
        maxDamageArea: loc.maxDamageArea,
        fireCause: loc.cause,
        weight: Math.min(loc.count / 5, 1),
        periodStart: args.period.start,
        periodEnd: args.period.end,
      },
    });
  }

  const source: 'mock' | 'upstream' = features.length > 0 ? 'upstream' : 'mock';

  return {
    source,
    json: {
      source,
      updatedAt: new Date().toISOString(),
      period: {
        start: args.period.start,
        end: args.period.end,
      },
      totalCount: rows.length,
      matchedCount,
      data: {
        type: 'FeatureCollection',
        features,
      } satisfies GeoJSON.FeatureCollection,
      warnings,
    },
  };
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const sourceOnlyRaw = (searchParams.get('sourceOnly') ?? '').trim().toLowerCase();
  const sourceOnly = sourceOnlyRaw === '1' || sourceOnlyRaw === 'true' || sourceOnlyRaw === 'yes';

  const apiKey =
    process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_DISASTER_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        period: resolvePeriod(searchParams),
        totalCount: 0,
        matchedCount: 0,
        data: emptyFeatureCollection(),
        warnings: [
          'Missing env: TEAM2_DISASTER_WILDFIRE_API_KEY (or TEAM2_DISASTER_API_KEY / TEAM2_PUBLIC_API_KEY)',
        ],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  const period = resolvePeriod(searchParams);

  const upstreamUrl = process.env.TEAM2_DISASTER_WILDFIRE_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const pageSize = clampInt(
    toPositiveInt(searchParams.get('numOfRows') ?? process.env.TEAM2_DISASTER_WILDFIRE_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const maxPages = clampInt(
    toPositiveInt(searchParams.get('maxPages') ?? process.env.TEAM2_DISASTER_WILDFIRE_MAX_PAGES, DEFAULT_MAX_PAGES),
    MIN_MAX_PAGES,
    MAX_MAX_PAGES
  );

  if (sourceOnly) {
    try {
      const probe = await fetchWildfirePage({
        upstreamUrl,
        apiKey,
        pageNo: 1,
        pageSize: 1,
        period,
      });

      const warnings = probe.warning ? [probe.warning] : [];
      const source: 'mock' | 'upstream' = warnings.length > 0 ? 'mock' : 'upstream';

      return NextResponse.json(
        {
          source,
          updatedAt: new Date().toISOString(),
          period,
          totalCount: probe.totalCount ?? probe.rows.length,
          warnings,
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': source } }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          source: 'mock',
          updatedAt: new Date().toISOString(),
          period,
          totalCount: 0,
          warnings: [`wildfire source probe failed: ${message}`],
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
      );
    }
  }

  const cacheKey = `${period.start}:${period.end}:${pageSize}:${maxPages}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached.json, {
      headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': cached.source },
    });
  }

  try {
    const result = await buildResult({
      apiKey,
      upstreamUrl,
      period,
      pageSize,
      maxPages,
    });

    cache.set(cacheKey, {
      json: result.json,
      source: result.source,
      cachedAt: Date.now(),
    });

    return NextResponse.json(result.json, {
      headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': result.source },
    });
  } catch (err) {
    const stale = cache.get(cacheKey);
    if (stale) {
      return NextResponse.json(stale.json, {
        headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': stale.source },
      });
    }

    const message = err instanceof Error ? err.message : String(err);

    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        period,
        totalCount: 0,
        matchedCount: 0,
        data: emptyFeatureCollection(),
        warnings: [`wildfire fetch failed: ${message}`],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }
}
