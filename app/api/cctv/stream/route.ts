import { NextResponse } from 'next/server';
import * as https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';

const SOURCE_LABEL = '출처: 경찰청 도시교통정보센터(UTIC)';
const NO_SIGNAL_MESSAGE = '영상 신호를 수신할 수 없습니다.';
const DEFAULT_BASE_URL = 'https://www.utic.go.kr/guide/cctvOpenData.do';
const MAP_CCTV_URL = 'https://www.utic.go.kr/map/mapcctv.do';
const STREAM_PAGE_URL = 'https://www.utic.go.kr/jsp/map/openDataCctvStream.jsp';
const REQUEST_TIMEOUT_MS = 15_000;
// UTIC 서버(utic.go.kr)가 불완전한 인증서 체인을 반환하여 TLS 검증 실패 → 개발 환경에서만 우회
const TLS_REJECT_UNAUTHORIZED = process.env.NODE_ENV === 'production';
const MAX_REDIRECTS = 3;
const LIST_FETCH_RETRY_COUNT = 3;
const LIST_FETCH_RETRY_DELAY_MS = 350;
const LIST_CACHE_TTL_MS = 60_000;
const COORDINATE_DISTANCE_GATE = 0.00008;
const COORDINATE_NEARBY_LIMIT = 40;
const MAX_FALLBACK_INDEX = 8;

export const runtime = 'nodejs';

type UpstreamSource = 'mock' | 'upstream';

interface UticCctvItem {
  CCTVID?: string;
  STRMID?: string;
  CCTVNAME?: string;
  KIND?: string;
  CCTVIP?: string;
  CH?: string | number;
  ID?: string | number;
  PASSWD?: string;
  PORT?: string | number;
  XCOORD?: string | number;
  YCOORD?: string | number;
}

type MatchStrategy = 'cctv-id' | 'coordinate-distance' | 'first-item';

let uticListCache:
  | {
      baseUrl: string;
      items: UticCctvItem[];
      cachedAt: number;
    }
  | null = null;

function compactQueryParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toNonNegativeInt(value: string | null, fallback: number): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return fallback;
  const normalized = Math.floor(parsed);
  if (!Number.isFinite(normalized) || normalized < 0) return fallback;
  return normalized;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toIdText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return toText(value);
}

function expandCctvIdCandidates(value: unknown): string[] {
  const raw = toIdText(value);
  if (!raw) return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates = new Set<string>();
  const lowered = trimmed.toLowerCase();
  candidates.add(trimmed);
  candidates.add(lowered);

  const dottedParts = trimmed.split('.');
  if (dottedParts.length > 1) {
    const tail = dottedParts[dottedParts.length - 1]?.trim();
    if (tail) {
      candidates.add(tail);
      candidates.add(tail.toLowerCase());
    }
  }

  const digitTail = trimmed.match(/(\d{3,})$/)?.[1];
  if (digitTail) {
    candidates.add(digitTail);
  }

  return Array.from(candidates);
}

function extractCookie(rawSetCookie: string, name: string): string | null {
  const match = rawSetCookie.match(new RegExp(`${name}=[^;,\\s]+`, 'i'));
  return match ? match[0] : null;
}

function makeCookieHeader(rawSetCookie: string | string[] | undefined): string | null {
  const source = Array.isArray(rawSetCookie)
    ? rawSetCookie.join('; ')
    : (rawSetCookie ?? '');
  const cookieNames = ['JSESSIONID', 'WMONID', 'SCOUTER'] as const;
  const cookieParts = cookieNames
    .map((name) => extractCookie(source, name))
    .filter((value): value is string => Boolean(value));
  if (cookieParts.length === 0) return null;
  return cookieParts.join('; ');
}

function getBaseUrlCandidates(): string[] {
  const envBase = toText(process.env.TEAM2_UTIC_CCTV_BASE_URL);
  if (!envBase || envBase === DEFAULT_BASE_URL) {
    return [DEFAULT_BASE_URL];
  }
  return [envBase, DEFAULT_BASE_URL];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCachedUticList(baseUrl: string): UticCctvItem[] | null {
  if (!uticListCache) return null;
  if (uticListCache.baseUrl !== baseUrl) return null;
  if (Date.now() - uticListCache.cachedAt > LIST_CACHE_TTL_MS) return null;
  return uticListCache.items;
}

interface HttpTextResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

async function getTextWithInsecureTls(
  url: string,
  headers?: Record<string, string>,
  redirectDepth = 0
): Promise<HttpTextResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers,
        timeout: REQUEST_TIMEOUT_MS,
        rejectUnauthorized: TLS_REJECT_UNAUTHORIZED,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location && redirectDepth < MAX_REDIRECTS) {
          response.resume();
          const nextUrl = new URL(location, url).toString();
          getTextWithInsecureTls(nextUrl, headers, redirectDepth + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            status,
            headers: response.headers,
            body,
          });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchUticList(baseUrl: string, key: string): Promise<{
  items: UticCctvItem[];
  warning?: string;
}> {
  const openUrl = new URL(baseUrl);
  openUrl.searchParams.set('key', key);

  const openResponse = await getTextWithInsecureTls(openUrl.toString());

  if (openResponse.status < 200 || openResponse.status >= 300) {
    return { items: [], warning: `UTIC open page responded ${openResponse.status}` };
  }

  const rawSetCookie = openResponse.headers['set-cookie'];
  const cookieHeader = makeCookieHeader(rawSetCookie);

  const mapResponse = await getTextWithInsecureTls(MAP_CCTV_URL, {
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    Referer: baseUrl,
    Accept: 'application/json,text/plain,*/*',
  });

  if (mapResponse.status < 200 || mapResponse.status >= 300) {
    return { items: [], warning: `UTIC map list responded ${mapResponse.status}` };
  }

  const rawText = mapResponse.body;
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!Array.isArray(parsed)) {
      return { items: [], warning: 'UTIC map list returned non-array payload' };
    }
    return { items: parsed as UticCctvItem[] };
  } catch {
    return { items: [], warning: 'UTIC map list returned invalid JSON payload' };
  }
}

function buildStreamPageUrl(item: UticCctvItem, key: string): string {
  const url = new URL(STREAM_PAGE_URL);
  url.searchParams.set('key', key);
  url.searchParams.set('cctvid', toText(item.CCTVID) ?? '');
  url.searchParams.set('cctvName', toText(item.CCTVNAME) ?? '');
  url.searchParams.set('kind', toText(item.KIND) ?? '');
  url.searchParams.set('cctvip', toText(item.CCTVIP) ?? '');
  url.searchParams.set('cctvch', String(item.CH ?? ''));
  url.searchParams.set('id', String(item.ID ?? ''));
  url.searchParams.set('cctvpasswd', toText(item.PASSWD) ?? '');
  url.searchParams.set('cctvport', String(item.PORT ?? ''));
  return url.toString();
}

function scoreByDistance(item: UticCctvItem, lng: number, lat: number): number {
  const x = toFiniteNumber(item.XCOORD);
  const y = toFiniteNumber(item.YCOORD);
  if (x === null || y === null) return Number.POSITIVE_INFINITY;
  const dx = x - lng;
  const dy = y - lat;
  return dx * dx + dy * dy;
}

function scoreByNamePriority(item: UticCctvItem): number {
  const name = (toText(item.CCTVNAME) ?? '').toLowerCase();
  if (!name) return 0;

  let score = 0;
  const preferredKeywords = [
    '교통',
    '사거리',
    '교차로',
    '고속',
    '국도',
    '터널',
    '교',
    'ic',
    'jc',
    '램프',
    '분기점',
    '영업소',
  ];
  const discouragedKeywords = [
    '생활방범',
    '차량방범',
    '방범',
    '쓰레기',
    '시설물관리',
    '시설물',
    '주차',
    '공원',
    '하천',
  ];

  for (const keyword of preferredKeywords) {
    if (name.includes(keyword)) {
      score -= 2;
    }
  }
  for (const keyword of discouragedKeywords) {
    if (name.includes(keyword)) {
      score += 8;
    }
  }

  return score;
}

function scoreByKindPriority(item: UticCctvItem): number {
  const kind = (toText(item.KIND) ?? '').toUpperCase();
  if (!kind) return 0;

  const preferredKinds = new Set(['EC', 'EE', 'MODE', 'I', 'K', 'N', 'Z3']);
  const discouragedKinds = new Set(['T', 'U', 'A', 'B']);

  if (preferredKinds.has(kind)) return -1;
  if (discouragedKinds.has(kind)) return 2;
  return 0;
}

function pickBestItem(items: UticCctvItem[], args: {
  cctvId: string | null;
  lng: number | null;
  lat: number | null;
  fallbackIndex: number;
}): {
  item: UticCctvItem | null;
  matchStrategy: MatchStrategy | null;
  candidateCount: number;
  candidateIndex: number;
} {
  if (items.length === 0) {
    return { item: null, matchStrategy: null, candidateCount: 0, candidateIndex: 0 };
  }

  if (args.cctvId) {
    const requestedCandidates = new Set(expandCctvIdCandidates(args.cctvId));
    const direct = items.find((item) => {
      const keys = [item.CCTVID, item.STRMID, item.ID]
        .flatMap((value) => expandCctvIdCandidates(value));
      return keys.some((key) => requestedCandidates.has(key));
    });
    if (direct) {
      return {
        item: direct,
        matchStrategy: 'cctv-id',
        candidateCount: 1,
        candidateIndex: 0,
      };
    }
  }

  if (args.lng !== null && args.lat !== null) {
    const measured = items
      .map((item) => ({
        item,
        distance: scoreByDistance(item, args.lng as number, args.lat as number),
      }))
      .filter((candidate) => Number.isFinite(candidate.distance))
      .sort((a, b) => a.distance - b.distance);

    const nearestDistance = measured[0]?.distance;
    if (nearestDistance !== undefined) {
      const distanceGate = Math.max(nearestDistance * 20, COORDINATE_DISTANCE_GATE);
      const rankedNearby = measured
        .filter((candidate) => candidate.distance <= distanceGate)
        .slice(0, COORDINATE_NEARBY_LIMIT)
        .sort((a, b) => {
          const aPriority = scoreByNamePriority(a.item) + scoreByKindPriority(a.item);
          const bPriority = scoreByNamePriority(b.item) + scoreByKindPriority(b.item);
          if (aPriority !== bPriority) return aPriority - bPriority;
          return a.distance - b.distance;
        });

      if (rankedNearby.length > 0) {
        const candidateIndex = Math.min(args.fallbackIndex, rankedNearby.length - 1);
        return {
          item: rankedNearby[candidateIndex]?.item ?? rankedNearby[0]?.item ?? null,
          matchStrategy: 'coordinate-distance',
          candidateCount: rankedNearby.length,
          candidateIndex,
        };
      }
    }
  }

  return {
    item: items[0] ?? null,
    matchStrategy: 'first-item',
    candidateCount: items.length > 0 ? 1 : 0,
    candidateIndex: 0,
  };
}

function buildResponse(args: {
  source: UpstreamSource;
  streamUrl: string | null;
  streamKind: 'video' | 'iframe';
  errorMessage?: string;
  matched?: UticCctvItem | null;
  matchStrategy?: MatchStrategy | null;
  fallbackIndex?: number;
  candidateCount?: number;
  warning?: string;
}) {
  return NextResponse.json(
    {
      source: args.source,
      updatedAt: new Date().toISOString(),
      streamUrl: args.streamUrl,
      streamKind: args.streamKind,
      sourceLabel: SOURCE_LABEL,
      matched: args.matched
        ? {
            cctvId: args.matched.CCTVID ?? null,
            name: args.matched.CCTVNAME ?? null,
            kind: args.matched.KIND ?? null,
            xcoord: args.matched.XCOORD ?? null,
            ycoord: args.matched.YCOORD ?? null,
          }
        : null,
      matchStrategy: args.matchStrategy ?? null,
      fallbackIndex: args.fallbackIndex ?? 0,
      candidateCount: args.candidateCount ?? 0,
      ...(args.errorMessage
        ? {
            error: {
              code: 'NO_SIGNAL',
              message: args.errorMessage,
            },
          }
        : {}),
      ...(args.warning ? { warnings: [args.warning] } : {}),
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': args.source,
      },
    }
  );
}

export async function GET(request: Request) {
  const key = toText(process.env.TEAM2_UTIC_CCTV_API_KEY);
  if (!key) {
    return buildResponse({
      source: 'mock',
      streamUrl: null,
      streamKind: 'iframe',
      errorMessage: `${NO_SIGNAL_MESSAGE} (Missing env: TEAM2_UTIC_CCTV_API_KEY)`,
      warning: 'UTIC key is not configured.',
    });
  }

  const url = new URL(request.url);
  const cctvId = compactQueryParam(url.searchParams.get('cctvId'));
  const lng = toFiniteNumber(url.searchParams.get('lng'));
  const lat = toFiniteNumber(url.searchParams.get('lat'));
  const fallbackIndex = Math.min(
    toNonNegativeInt(url.searchParams.get('fallback'), 0),
    MAX_FALLBACK_INDEX
  );

  let lastWarning: string | undefined;
  let items: UticCctvItem[] = [];

  for (const baseUrl of getBaseUrlCandidates()) {
    const cached = getCachedUticList(baseUrl);
    if (cached && cached.length > 0) {
      items = cached;
      break;
    }

    for (let attempt = 1; attempt <= LIST_FETCH_RETRY_COUNT; attempt += 1) {
      try {
        const result = await fetchUticList(baseUrl, key);
        if (result.items.length > 0) {
          items = result.items;
          uticListCache = {
            baseUrl,
            items: result.items,
            cachedAt: Date.now(),
          };
          lastWarning = result.warning;
          break;
        }

        lastWarning = result.warning ?? `UTIC list is empty (${baseUrl})`;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        lastWarning = `UTIC fetch failed for ${baseUrl} (attempt ${attempt}/${LIST_FETCH_RETRY_COUNT}): ${message}`;
      }

      if (attempt < LIST_FETCH_RETRY_COUNT) {
        await sleep(LIST_FETCH_RETRY_DELAY_MS * attempt);
      }
    }

    if (items.length > 0) {
      break;
    }
  }

  if (items.length === 0) {
    return buildResponse({
      source: 'mock',
      streamUrl: null,
      streamKind: 'iframe',
      errorMessage: `${NO_SIGNAL_MESSAGE} (UTIC 목록 조회 실패)`,
      warning: lastWarning ?? 'UTIC list is empty.',
    });
  }

  const {
    item: matched,
    matchStrategy,
    candidateCount,
    candidateIndex,
  } = pickBestItem(items, { cctvId, lng, lat, fallbackIndex });
  if (!matched) {
    return buildResponse({
      source: 'mock',
      streamUrl: null,
      streamKind: 'iframe',
      errorMessage: `${NO_SIGNAL_MESSAGE} (매칭 CCTV 없음)`,
      matchStrategy,
      fallbackIndex: candidateIndex,
      candidateCount,
      warning: 'No CCTV matched from UTIC list.',
    });
  }

  const pickWarning = cctvId && matchStrategy !== 'cctv-id'
    ? `요청 ID(${cctvId}) direct match 실패로 ${matchStrategy} 매칭 사용`
    : undefined;
  const candidateWarning = matchStrategy === 'coordinate-distance'
    ? `인접 후보 ${candidateIndex + 1}/${candidateCount} 선택`
    : undefined;

  const streamPageUrl = buildStreamPageUrl(matched, key);
  return buildResponse({
    source: 'upstream',
    streamUrl: streamPageUrl,
    streamKind: 'iframe',
    matched,
    matchStrategy,
    fallbackIndex: candidateIndex,
    candidateCount,
    warning: [lastWarning, pickWarning, candidateWarning].filter(Boolean).join(' | ') || undefined,
  });
}
