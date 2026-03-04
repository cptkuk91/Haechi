import { NextResponse } from 'next/server';

/* ------------------------------------------------------------------ */
/*  OpenSky Network – Real-time aircraft states (states/all)          */
/*  Auth: OAuth2 Client Credentials → Bearer token                    */
/*  Docs: https://openskynetwork.github.io/opensky-api/rest.html      */
/* ------------------------------------------------------------------ */

const OPENSKY_API = 'https://opensky-network.org/api/states/all';
const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

const CLIENT_ID = process.env.TEAM2_AVIATION_OPENSKY_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.TEAM2_AVIATION_OPENSKY_CLIENT_SECRET ?? '';
const BBOX = process.env.TEAM2_AVIATION_OPENSKY_BBOX ?? '33,124,39,132';

const TIMEOUT_MS = 10_000;

/* ---- OAuth2 token cache ------------------------------------------ */

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s margin)
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OAuth2 token request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = body.access_token;
  // expires_in is in seconds; default 30 min if not provided
  tokenExpiresAt = Date.now() + (body.expires_in ?? 1800) * 1000;
  return cachedToken;
}

/* ---- helpers ------------------------------------------------------ */

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;

function guessAircraftType(callsign: string): string {
  const cs = callsign.trim().toUpperCase();
  if (/^H[A-Z]?\d/.test(cs)) return 'helicopter';
  if (/^(FDX|UPS|GTI|CLX|ABW|CKK|KAL\d{3}[CF])/.test(cs)) return 'cargo';
  return 'passenger';
}

interface OpenSkyState {
  icao24: string;
  callsign: string;
  origin_country: string;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  geo_altitude: number | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  on_ground: boolean;
}

function parseState(s: unknown[]): OpenSkyState | null {
  if (!Array.isArray(s) || s.length < 17) return null;
  const lon = s[5] as number | null;
  const lat = s[6] as number | null;
  if (lon == null || lat == null) return null;

  return {
    icao24: String(s[0] ?? ''),
    callsign: String(s[1] ?? '').trim(),
    origin_country: String(s[2] ?? ''),
    longitude: lon,
    latitude: lat,
    baro_altitude: s[7] as number | null,
    geo_altitude: s[13] as number | null,
    velocity: s[9] as number | null,
    true_track: s[10] as number | null,
    vertical_rate: s[11] as number | null,
    on_ground: Boolean(s[8]),
  };
}

function toFeature(state: OpenSkyState, index: number): GeoJSON.Feature {
  const altMeters = state.baro_altitude ?? state.geo_altitude ?? 0;
  const speedMs = state.velocity ?? 0;
  const callsign = state.callsign || state.icao24;

  return {
    type: 'Feature',
    id: `opensky-${state.icao24}`,
    geometry: {
      type: 'Point',
      coordinates: [state.longitude!, state.latitude!],
    },
    properties: {
      icao24: state.icao24,
      callsign,
      altitude: Math.round(altMeters * M_TO_FT),
      speed: Math.round(speedMs * MS_TO_KT),
      heading: state.true_track ?? 0,
      aircraftType: guessAircraftType(callsign),
      verticalRate: state.vertical_rate ?? 0,
      onGround: state.on_ground,
      origin_country: state.origin_country,
      _index: index,
    },
  };
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function mockResponse(warnings: string[]) {
  return NextResponse.json(
    { source: 'mock' as const, updatedAt: new Date().toISOString(), data: emptyFC(), warnings },
    { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } },
  );
}

/* ---- route handler ------------------------------------------------ */

export async function GET() {
  const warnings: string[] = [];

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return mockResponse(['OpenSky credentials not configured; using simulation fallback']);
  }

  try {
    // 1) Get OAuth2 Bearer token
    const token = await getAccessToken();

    // 2) Fetch states with BBOX
    const [lamin, lomin, lamax, lomax] = BBOX.split(',').map(Number);
    const url = new URL(OPENSKY_API);
    url.searchParams.set('lamin', String(lamin));
    url.searchParams.set('lomin', String(lomin));
    url.searchParams.set('lamax', String(lamax));
    url.searchParams.set('lomax', String(lomax));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeout);

    if (res.status === 401) {
      // Token may have been revoked; clear cache and retry once
      cachedToken = null;
      tokenExpiresAt = 0;
      warnings.push('OpenSky token expired, will retry next poll');
      return mockResponse(warnings);
    }

    if (!res.ok) {
      warnings.push(`OpenSky returned ${res.status}`);
      return mockResponse(warnings);
    }

    const body = (await res.json()) as { time?: number; states?: unknown[][] };
    const rawStates = body.states ?? [];

    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < rawStates.length; i++) {
      const parsed = parseState(rawStates[i]);
      if (parsed) features.push(toFeature(parsed, i));
    }

    if (features.length === 0) {
      warnings.push('OpenSky returned 0 aircraft in the requested BBOX');
    }

    return NextResponse.json(
      {
        source: 'upstream' as const,
        updatedAt: new Date().toISOString(),
        data: { type: 'FeatureCollection', features } satisfies GeoJSON.FeatureCollection,
        warnings,
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'upstream' } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`OpenSky fetch failed: ${msg}`);
    return mockResponse(warnings);
  }
}
