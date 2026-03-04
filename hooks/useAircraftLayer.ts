'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const AIRCRAFT_LAYER_ID = 'aircraft-live';
const TRAILS_LAYER_ID = 'aircraft-trails';
const POLL_MS = 15_000;
const TRAIL_MAX_POINTS = 20;
const TRAIL_EXPIRE_MS = 2 * 60_000; // 2분

/* ================================================================== */
/*  Simulation fallback (기존 코드 보존)                                */
/* ================================================================== */

const FLIGHT_PATHS: Array<{
  callsign: string;
  type: 'passenger' | 'cargo' | 'helicopter';
  altitude: number; // feet
  speed: number; // knots
  path: [number, number][];
}> = [
  {
    callsign: 'KE901', type: 'passenger', altitude: 35000, speed: 480,
    path: [[126.44, 37.46], [126.80, 37.20], [127.50, 36.50], [128.60, 35.88], [129.04, 35.12]],
  },
  {
    callsign: 'OZ321', type: 'passenger', altitude: 33000, speed: 460,
    path: [[129.04, 35.12], [128.30, 35.90], [127.40, 36.70], [126.80, 37.30], [126.44, 37.46]],
  },
  {
    callsign: 'KE115', type: 'passenger', altitude: 38000, speed: 500,
    path: [[126.44, 37.46], [125.50, 37.80], [124.00, 38.50], [122.00, 39.00], [120.00, 39.50]],
  },
  {
    callsign: 'JL92', type: 'passenger', altitude: 36000, speed: 490,
    path: [[132.00, 37.00], [130.50, 36.50], [129.50, 36.00], [128.00, 35.50], [126.44, 37.46]],
  },
  {
    callsign: 'TW201', type: 'passenger', altitude: 31000, speed: 440,
    path: [[126.97, 37.55], [126.79, 35.14], [126.53, 33.50]],
  },
  {
    callsign: 'TW202', type: 'passenger', altitude: 32000, speed: 440,
    path: [[126.53, 33.50], [126.80, 35.20], [126.97, 37.55]],
  },
  {
    callsign: 'KE703', type: 'cargo', altitude: 28000, speed: 420,
    path: [[126.44, 37.46], [127.00, 37.00], [127.80, 36.00], [128.80, 35.20], [129.04, 35.12]],
  },
  {
    callsign: 'H-101', type: 'helicopter', altitude: 3000, speed: 120,
    path: [[126.95, 37.57], [126.98, 37.54], [127.00, 37.52], [127.03, 37.50], [127.05, 37.48]],
  },
  {
    callsign: 'LJ501', type: 'passenger', altitude: 34000, speed: 470,
    path: [[126.72, 35.96], [127.10, 36.50], [127.40, 37.00], [126.97, 37.55]],
  },
  {
    callsign: 'KE505', type: 'passenger', altitude: 37000, speed: 485,
    path: [[126.49, 33.51], [127.00, 34.50], [128.00, 35.50], [129.00, 36.50], [129.40, 37.50]],
  },
];

function interpolate(path: [number, number][], t: number): [number, number] {
  const n = path.length - 1;
  const idx = Math.min(Math.floor(t * n), n - 1);
  const frac = (t * n) - idx;
  const [x0, y0] = path[idx];
  const [x1, y1] = path[idx + 1];
  return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac];
}

function getHeading(path: [number, number][], t: number): number {
  const n = path.length - 1;
  const idx = Math.min(Math.floor(t * n), n - 1);
  const [x0, y0] = path[idx];
  const [x1, y1] = path[idx + 1];
  return (Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI;
}

function buildSimGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 60000;
  return {
    type: 'FeatureCollection',
    features: FLIGHT_PATHS.map((flight, i) => {
      const offset = (i * 7919) % cycleDuration;
      const t = ((time + offset) % cycleDuration) / cycleDuration;
      const pos = interpolate(flight.path, t);
      const heading = getHeading(flight.path, t);
      return {
        type: 'Feature' as const,
        id: `aircraft-${i}`,
        geometry: { type: 'Point' as const, coordinates: pos },
        properties: {
          callsign: flight.callsign,
          aircraftType: flight.type,
          altitude: flight.altitude,
          speed: flight.speed,
          heading,
        },
      };
    }),
  };
}

function buildSimTrailGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 60000;
  const trailPoints = 12;
  return {
    type: 'FeatureCollection',
    features: FLIGHT_PATHS.map((flight, i) => {
      const offset = (i * 7919) % cycleDuration;
      const t = ((time + offset) % cycleDuration) / cycleDuration;
      const coords: [number, number][] = [];
      for (let j = trailPoints; j >= 0; j--) {
        const pastT = Math.max(0, t - (j * 0.02));
        coords.push(interpolate(flight.path, pastT));
      }
      return {
        type: 'Feature' as const,
        id: `trail-${i}`,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: { callsign: flight.callsign },
      };
    }),
  };
}

/* ================================================================== */
/*  API types                                                          */
/* ================================================================== */

interface OpenSkyAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
}

/* ================================================================== */
/*  Trail accumulator                                                  */
/* ================================================================== */

interface TrailEntry {
  coords: [number, number][];
  lastSeen: number;
}

/* ================================================================== */
/*  Hook                                                               */
/* ================================================================== */

export function useAircraftLayer() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const selectObject = useAppStore((s) => s.selectObject);

  const aircraftVisible = useAppStore(
    (s) => s.layers[AIRCRAFT_LAYER_ID]?.visible ?? false,
  );

  const registered = useRef(false);
  const trailsRef = useRef<Map<string, TrailEntry>>(new Map());
  const seenWarnings = useRef<Set<string>>(new Set());
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Register layers (once) ------------------------------------
  useEffect(() => {
    if (registered.current) return;

    addLayer({
      id: AIRCRAFT_LAYER_ID,
      domain: 'aviation',
      name: '실시간 항공기 (완료)',
      type: 'marker',
      visible: false,
      data: buildSimGeoJSON(0),
      style: { color: '#00f0ff', radius: 300, opacity: 1 },
      onClick: (feature) =>
        selectObject(
          toSelectedObjectFromFeature(feature, {
            id: AIRCRAFT_LAYER_ID,
            domain: 'aviation',
            type: 'marker',
          }),
        ),
    });
    addLayer({
      id: TRAILS_LAYER_ID,
      domain: 'aviation',
      name: '항공기 궤적 (완료)',
      type: 'line',
      visible: false,
      data: buildSimTrailGeoJSON(0),
      style: { color: [0, 240, 255, 100], lineWidth: 2 },
      onClick: (feature) =>
        selectObject(
          toSelectedObjectFromFeature(feature, {
            id: TRAILS_LAYER_ID,
            domain: 'aviation',
            type: 'line',
          }),
        ),
    });
    registered.current = true;
  }, [addLayer, selectObject]);

  // ---- Source probe (runs even when layer off) -------------------
  const sourceProbeQuery = useQuery({
    queryKey: ['aviation', 'opensky', 'source-probe'],
    queryFn: async (): Promise<OpenSkyAPIResponse> => {
      const res = await fetch('/api/aviation/opensky', { cache: 'no-store' });
      if (!res.ok) throw new Error(`OpenSky probe failed: ${res.status}`);
      return (await res.json()) as OpenSkyAPIResponse;
    },
    staleTime: 30 * 60_000,
    retry: 1,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  // ---- Main data query (only when visible) -----------------------
  const query = useQuery({
    queryKey: ['aviation', 'opensky', 'states'],
    queryFn: async (): Promise<OpenSkyAPIResponse> => {
      const res = await fetch('/api/aviation/opensky', { cache: 'no-store' });
      if (!res.ok) throw new Error(`OpenSky fetch failed: ${res.status}`);
      return (await res.json()) as OpenSkyAPIResponse;
    },
    staleTime: POLL_MS - 1000,
    retry: 2,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
    enabled: aircraftVisible,
  });

  usePolling(['aviation', 'opensky', 'states'], POLL_MS, aircraftVisible);

  // ---- Process source probe result -------------------------------
  useEffect(() => {
    const payload = sourceProbeQuery.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(AIRCRAFT_LAYER_ID, source);
    setDomainDataSource('aviation', source);

    if (payload.warnings?.length) {
      for (const w of payload.warnings) {
        const key = `opensky:${w}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[OpenSky] ${w}`);
      }
    }
  }, [setDomainDataSource, setLayerDataSource, sourceProbeQuery.data]);

  // ---- Build trails FC from accumulated data ---------------------
  const buildTrailsFC = useCallback((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = [];
    trailsRef.current.forEach((entry, icao24) => {
      if (entry.coords.length < 2) return;
      features.push({
        type: 'Feature',
        id: `trail-${icao24}`,
        geometry: { type: 'LineString', coordinates: entry.coords },
        properties: { icao24 },
      });
    });
    return { type: 'FeatureCollection', features };
  }, []);

  // ---- Process main query data → update layers ------------------
  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(AIRCRAFT_LAYER_ID, source);
    setDomainDataSource('aviation', source);

    if (payload.warnings?.length) {
      for (const w of payload.warnings) {
        const key = `opensky:${w}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[OpenSky] ${w}`);
      }
    }

    // If upstream returned actual data → use it
    if (
      source === 'upstream' &&
      payload.data &&
      payload.data.type === 'FeatureCollection' &&
      payload.data.features.length > 0
    ) {
      // Stop simulation if running
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }

      updateLayerData(AIRCRAFT_LAYER_ID, payload.data);

      // Accumulate trails
      const now = Date.now();
      for (const feature of payload.data.features) {
        if (feature.geometry.type !== 'Point') continue;
        const icao24 = (feature.properties?.icao24 ?? feature.id ?? '') as string;
        if (!icao24) continue;

        const coord = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const entry = trailsRef.current.get(icao24);

        if (entry) {
          entry.coords.push(coord);
          if (entry.coords.length > TRAIL_MAX_POINTS) {
            entry.coords.shift();
          }
          entry.lastSeen = now;
        } else {
          trailsRef.current.set(icao24, { coords: [coord], lastSeen: now });
        }
      }

      // Purge stale trails (unseen for > 2 minutes)
      trailsRef.current.forEach((entry, key) => {
        if (now - entry.lastSeen > TRAIL_EXPIRE_MS) {
          trailsRef.current.delete(key);
        }
      });

      updateLayerData(TRAILS_LAYER_ID, buildTrailsFC());
      return;
    }

    // No upstream data → run simulation fallback (handled below)
  }, [buildTrailsFC, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);

  // ---- Simulation fallback (when no upstream data) ---------------
  useEffect(() => {
    if (!aircraftVisible) {
      // Layer hidden → stop simulation
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      return;
    }

    const source = query.data?.source ?? sourceProbeQuery.data?.source ?? 'mock';
    const hasUpstreamData =
      source === 'upstream' &&
      query.data?.data?.features &&
      query.data.data.features.length > 0;

    if (hasUpstreamData) {
      // Upstream active → no simulation needed
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
      return;
    }

    // Fallback: run simulation
    if (!simIntervalRef.current) {
      simIntervalRef.current = setInterval(() => {
        const now = Date.now();
        updateLayerData(AIRCRAFT_LAYER_ID, buildSimGeoJSON(now));
        updateLayerData(TRAILS_LAYER_ID, buildSimTrailGeoJSON(now));
      }, 2000);
    }

    return () => {
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    };
  }, [aircraftVisible, query.data, sourceProbeQuery.data, updateLayerData]);
}
