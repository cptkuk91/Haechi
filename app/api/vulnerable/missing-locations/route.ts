import { NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';

const SAFE182_URL = 'https://www.safe182.go.kr/api/lcm/amberList.do';
const ROW_SIZE = 100;
const CACHE_TTL_MS = 6 * 60 * 60_000; // 6시간

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
  dongName: string;
  lat: number | null;
  lng: number | null;
}

interface CachedResult {
  json: Record<string, unknown>;
  source: string;
  cachedAt: number;
}

// ── 인메모리 캐시 ──────────────────────────────────────────────────
let cache: CachedResult | null = null;

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** 시도 약칭 → 정식명칭 맵 */
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
  // 과거·약칭 → 현행 명칭
  강원도: '강원특별자치도',
  전라북도: '전북특별자치도',
  전북: '전북특별자치도',
  // 시 단독 사용 (시도 없이 시부터 시작하는 경우)
  광주시: '광주광역시',
  안산: '경기도',
};

/** 폐지된 시군구 → 현행 시군구 매핑 */
const SIGUNGU_ALIAS: Record<string, { sido: string; sigungu: string }> = {
  '경상남도 진해시': { sido: '경상남도', sigungu: '창원시 진해구' },
  '경상북도 군위군': { sido: '대구광역시', sigungu: '군위군' },
};

function parseAddress(raw: string): { sido: string; sigungu: string; dong: string | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;

  let sido = parts[0];
  sido = SIDO_ALIAS[sido] ?? sido;

  const sigungu = parts[1];

  const dongSuffixes = /[동읍면가리]$/;
  for (let i = 2; i < parts.length; i++) {
    if (dongSuffixes.test(parts[i])) {
      return { sido, sigungu, dong: parts[i] };
    }
  }

  return { sido, sigungu, dong: null };
}

async function fetchAllPages(esntlId: string, authKey: string): Promise<Safe182Item[]> {
  const allItems: Safe182Item[] = [];
  let page = 1;
  let totalCount = 0;

  do {
    const body = new URLSearchParams({
      esntlId,
      authKey,
      rowSize: String(ROW_SIZE),
      page: String(page),
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

    if (page === 1) {
      totalCount = typeof json.totalCount === 'number' ? json.totalCount : 0;
    }

    if (Array.isArray(json.list)) {
      allItems.push(...json.list);
    }

    page += 1;
  } while (allItems.length < totalCount);

  return allItems;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildCoordMaps(collection: any) {
  const docs: DongCoordinate[] = await collection
    .find({ lat: { $ne: null }, lng: { $ne: null } })
    .project({ fullAddress: 1, sidoName: 1, sigunguName: 1, lat: 1, lng: 1 })
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

async function buildResult(esntlId: string, authKey: string): Promise<{ json: Record<string, unknown>; source: string }> {
  const warnings: string[] = [];

  const items = await fetchAllPages(esntlId, authKey);

  const client = await clientPromise;
  const collection = client.db('haechi').collection('dong_coordinates');
  const { exactMap, sigunguMap } = await buildCoordMaps(collection);

  const locationCounts = new Map<string, { lat: number; lng: number; count: number; address: string }>();
  let unparsedCount = 0;
  let unmatchedCount = 0;

  for (const item of items) {
    const addr = typeof item.occrAdres === 'string' ? item.occrAdres : '';
    const parsed = parseAddress(addr);
    if (!parsed) { unparsedCount++; continue; }

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

    if (!coord) { unmatchedCount++; continue; }

    const existing = locationCounts.get(locationKey);
    if (existing) {
      existing.count++;
    } else {
      locationCounts.set(locationKey, { ...coord, count: 1, address: locationKey });
    }
  }

  if (unparsedCount > 0) warnings.push(`${unparsedCount}건의 주소를 파싱할 수 없습니다`);
  if (unmatchedCount > 0) warnings.push(`${unmatchedCount}건의 주소를 좌표에 매칭할 수 없습니다`);

  const features: GeoJSON.Feature[] = [];
  let matchedCount = 0;

  for (const [, loc] of locationCounts) {
    matchedCount += loc.count;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
      properties: { address: loc.address, count: loc.count, weight: Math.min(loc.count / 3, 1) },
    });
  }

  const source = features.length > 0 ? 'upstream' : 'mock';

  return {
    source,
    json: {
      source,
      updatedAt: new Date().toISOString(),
      data: { type: 'FeatureCollection', features } satisfies GeoJSON.FeatureCollection,
      totalCount: items.length,
      matchedCount,
      warnings,
    },
  };
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const sourceOnlyRaw = (searchParams.get('sourceOnly') ?? '').trim().toLowerCase();
  const sourceOnly = sourceOnlyRaw === '1' || sourceOnlyRaw === 'true' || sourceOnlyRaw === 'yes';

  const esntlId = process.env.TEAM2_SAFE182_ESNTL_ID;
  const authKey = process.env.TEAM2_SAFE182_AUTH_KEY;

  if (!esntlId || !authKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        totalCount: 0,
        matchedCount: 0,
        warnings: ['Missing env: TEAM2_SAFE182_ESNTL_ID or TEAM2_SAFE182_AUTH_KEY'],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  if (sourceOnly) {
    try {
      const probe = await fetchSourceProbe(esntlId, authKey);
      return NextResponse.json(
        {
          source: 'upstream',
          updatedAt: new Date().toISOString(),
          totalCount: probe.totalCount,
          warnings: [],
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'upstream' } }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (cache) {
        return NextResponse.json(
          {
            source: cache.source,
            updatedAt: new Date().toISOString(),
            totalCount: typeof cache.json.totalCount === 'number' ? cache.json.totalCount : 0,
            warnings: [`safe182 source probe failed: ${message}`],
          },
          { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': cache.source } }
        );
      }

      return NextResponse.json(
        {
          source: 'mock',
          updatedAt: new Date().toISOString(),
          totalCount: 0,
          warnings: [`safe182 source probe failed: ${message}`],
        },
        { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
      );
    }
  }

  // 캐시 히트 → 즉시 반환
  if (cache && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json(cache.json, {
      headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': cache.source },
    });
  }

  try {
    const result = await buildResult(esntlId, authKey);

    // 캐시 저장
    cache = { json: result.json, source: result.source, cachedAt: Date.now() };

    return NextResponse.json(result.json, {
      headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': result.source },
    });
  } catch (err) {
    // 에러 시 기존 캐시가 있으면 stale 캐시 반환
    if (cache) {
      return NextResponse.json(cache.json, {
        headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': cache.source },
      });
    }

    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        totalCount: 0,
        matchedCount: 0,
        warnings: [`safe182 fetch failed: ${message}`],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }
}
