import * as https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';

export interface UticCctvItem {
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

const DEFAULT_BASE_URL = 'https://www.utic.go.kr/guide/cctvOpenData.do';
const MAP_CCTV_URL = 'https://www.utic.go.kr/map/mapcctv.do';
const STREAM_PAGE_URL = 'https://www.utic.go.kr/jsp/map/openDataCctvStream.jsp';
const REQUEST_TIMEOUT_MS = 15_000;
const TLS_REJECT_UNAUTHORIZED = process.env.NODE_ENV === 'production';
const MAX_REDIRECTS = 3;
const LIST_FETCH_RETRY_COUNT = 3;
const LIST_FETCH_RETRY_DELAY_MS = 350;
const LIST_CACHE_TTL_MS = 60_000;

let uticListCache:
  | {
      baseUrl: string;
      items: UticCctvItem[];
      cachedAt: number;
    }
  | null = null;

export function compactQueryParam(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function toText(value: unknown): string | null {
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

export function getUticId(item: UticCctvItem): string | null {
  return toIdText(item.CCTVID) ?? toIdText(item.STRMID) ?? toIdText(item.ID);
}

export function expandCctvIdCandidates(value: unknown): string[] {
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

export function findDirectUticItem(items: UticCctvItem[], cctvId: string | null): UticCctvItem | null {
  if (!cctvId) return null;

  const requestedCandidates = new Set(expandCctvIdCandidates(cctvId));
  for (const item of items) {
    const keys = [item.CCTVID, item.STRMID, item.ID].flatMap((value) => expandCctvIdCandidates(value));
    if (keys.some((key) => requestedCandidates.has(key))) {
      return item;
    }
  }

  return null;
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

function getTextWithInsecureTls(
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

  try {
    const parsed = JSON.parse(mapResponse.body) as unknown;
    if (!Array.isArray(parsed)) {
      return { items: [], warning: 'UTIC map list returned non-array payload' };
    }
    return { items: parsed as UticCctvItem[] };
  } catch {
    return { items: [], warning: 'UTIC map list returned invalid JSON payload' };
  }
}

export async function fetchUticItems(key: string): Promise<{
  items: UticCctvItem[];
  warning?: string;
}> {
  let lastWarning: string | undefined;

  for (const baseUrl of getBaseUrlCandidates()) {
    const cached = getCachedUticList(baseUrl);
    if (cached && cached.length > 0) {
      return { items: cached };
    }

    for (let attempt = 1; attempt <= LIST_FETCH_RETRY_COUNT; attempt += 1) {
      try {
        const result = await fetchUticList(baseUrl, key);
        if (result.items.length > 0) {
          uticListCache = {
            baseUrl,
            items: result.items,
            cachedAt: Date.now(),
          };
          return { items: result.items, warning: result.warning };
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
  }

  return { items: [], warning: lastWarning ?? 'UTIC list is empty.' };
}

export function buildUticStreamPageUrl(item: UticCctvItem, key: string): string {
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

export function getUticCoordinates(item: UticCctvItem): [number, number] | null {
  const lng = toFiniteNumber(item.XCOORD);
  const lat = toFiniteNumber(item.YCOORD);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}

export function scoreByDistance(item: UticCctvItem, lng: number, lat: number): number {
  const coords = getUticCoordinates(item);
  if (!coords) return Number.POSITIVE_INFINITY;
  const [itemLng, itemLat] = coords;
  const dx = itemLng - lng;
  const dy = itemLat - lat;
  return dx * dx + dy * dy;
}

export function scoreByNamePriority(item: UticCctvItem): number {
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
    '로터리',
    '오거리',
    '삼거리',
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
    '다목적',
    '단속',
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

export function scoreByKindPriority(item: UticCctvItem): number {
  const kind = (toText(item.KIND) ?? '').toUpperCase();
  if (!kind) return 0;

  const preferredKinds = new Set(['EC', 'EE', 'MODE', 'I', 'K', 'N', 'Z3']);
  const discouragedKinds = new Set(['T', 'U', 'A', 'B']);

  if (preferredKinds.has(kind)) return -1;
  if (discouragedKinds.has(kind)) return 2;
  return 0;
}

export function isTrafficQualifiedUticItem(item: UticCctvItem): boolean {
  const uticId = getUticId(item);
  const coords = getUticCoordinates(item);
  if (!uticId || !coords) return false;

  const kindPenalty = scoreByKindPriority(item);
  const namePenalty = scoreByNamePriority(item);

  if (kindPenalty >= 2) return false;
  if (namePenalty >= 8) return false;

  const name = (toText(item.CCTVNAME) ?? '').toLowerCase();
  const kind = (toText(item.KIND) ?? '').toUpperCase();
  if (!name && !kind) return false;

  if (kindPenalty < 0) return true;

  const preferredKeywords = ['교통', '사거리', '교차로', '고속', '국도', '터널', 'ic', 'jc', '램프', '분기점', '영업소', '로터리', '오거리', '삼거리'];
  return preferredKeywords.some((keyword) => name.includes(keyword.toLowerCase()));
}
