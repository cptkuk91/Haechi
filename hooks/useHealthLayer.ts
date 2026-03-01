'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';

const UPDATE_INTERVAL_MS = 2800;
const ALERT_COOLDOWN_MS = 55_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pointCoordinates(feature: GeoJSON.Feature): [number, number] | null {
  const geometry = feature.geometry;
  if (!geometry || geometry.type !== 'Point') return null;
  return [geometry.coordinates[0], geometry.coordinates[1]];
}

function interpolatePath(path: [number, number][], t: number): [number, number] {
  if (path.length === 0) return [127.5, 36.5];
  if (path.length === 1) return path[0];

  const segments = path.length - 1;
  const idx = Math.min(Math.floor(t * segments), segments - 1);
  const frac = t * segments - idx;

  const [x0, y0] = path[idx];
  const [x1, y1] = path[idx + 1];
  return [x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac];
}

function updateAmbulanceRoute(collection: GeoJSON.FeatureCollection, now: number): GeoJSON.FeatureCollection {
  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const etaBase = toNumber(props.baseEtaMin) ?? toNumber(props.etaMin) ?? 6 + index;
    const etaMin = Math.max(1, Math.round(etaBase + Math.sin(now / 3600 + index * 0.9) * 2));
    const pulse = clamp(0.55 + ((Math.sin(now / 1600 + index) + 1) / 2) * 0.5, 0.3, 1.1);

    return {
      ...feature,
      properties: {
        ...props,
        baseEtaMin: Number(etaBase.toFixed(1)),
        etaMin,
        pulse: Number(pulse.toFixed(2)),
      },
    };
  });

  return {
    ...collection,
    features,
  };
}

function updateAmbulanceTrack(
  trackCollection: GeoJSON.FeatureCollection,
  routeCollection: GeoJSON.FeatureCollection,
  now: number
): GeoJSON.FeatureCollection {
  const routeMap = new Map<string, [number, number][]>();
  for (const routeFeature of routeCollection.features) {
    const props = (routeFeature.properties as Record<string, unknown> | null) ?? {};
    const ambulanceId = typeof props.ambulanceId === 'string' ? props.ambulanceId : null;
    const geometry = routeFeature.geometry;
    if (!ambulanceId || !geometry || geometry.type !== 'LineString') continue;
    routeMap.set(ambulanceId, geometry.coordinates as [number, number][]);
  }

  const features = trackCollection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const id = typeof props.id === 'string' ? props.id : `ambulance-${index + 1}`;
    const route = routeMap.get(id);
    if (!route || route.length < 2) return feature;

    const cycle = 36_000;
    const offset = (index * 7000) % cycle;
    const t = ((now + offset) % cycle) / cycle;
    const point = interpolatePath(route, t);
    const etaMin = Math.max(1, Math.round((1 - t) * 8));

    const nextFeature: GeoJSON.Feature<GeoJSON.Point> = {
      ...feature,
      geometry: {
        type: 'Point',
        coordinates: point,
      },
      properties: {
        ...props,
        id,
        etaMin,
        speedKph: Math.round(38 + Math.sin(now / 2400 + index) * 9),
        status: etaMin <= 2 ? 'arrival' : 'dispatch',
      },
    };
    return nextFeature;
  });

  return {
    ...trackCollection,
    features,
  };
}

function updateERCapacity(
  collection: GeoJSON.FeatureCollection,
  now: number
): {
  collection: GeoJSON.FeatureCollection;
  peakOccupancy: number;
  focus?: [number, number];
} {
  let peakOccupancy = 0;
  let focus: [number, number] | undefined;

  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseOcc = toNumber(props.baseOccupancyPct) ?? toNumber(props.occupancyPct) ?? 72 + index * 6;
    const occWave = Math.sin(now / 3400 + index) * 8 + Math.cos(now / 9200 + index * 1.1) * 4;
    const occupancyPct = Math.round(clamp(baseOcc + occWave, 48, 98));
    const availableBeds = Math.max(0, Math.round(22 - occupancyPct / 4));
    const severity = occupancyPct >= 92 ? 'critical' : occupancyPct >= 80 ? 'warning' : 'info';

    const anchor = pointCoordinates(feature);
    if (occupancyPct > peakOccupancy) {
      peakOccupancy = occupancyPct;
      focus = anchor ?? focus;
    }

    return {
      ...feature,
      properties: {
        ...props,
        baseOccupancyPct: Number(baseOcc.toFixed(1)),
        occupancyPct,
        availableBeds,
        severity,
      },
    };
  });

  return {
    collection: {
      ...collection,
      features,
    },
    peakOccupancy,
    focus,
  };
}

export function useHealthLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const lastAlertAt = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const state = useAppStore.getState();

      const route = state.layers['health-ambulance-route']?.data;
      if (route) {
        updateLayerData('health-ambulance-route', updateAmbulanceRoute(route, now));
      }

      const track = state.layers['health-ambulance-track']?.data;
      if (track && route) {
        updateLayerData('health-ambulance-track', updateAmbulanceTrack(track, route, now));
      }

      const er = state.layers['health-er-capacity']?.data;
      if (er) {
        const next = updateERCapacity(er, now);
        updateLayerData('health-er-capacity', next.collection);

        if (
          next.peakOccupancy >= 93 &&
          next.focus &&
          now - lastAlertAt.current > ALERT_COOLDOWN_MS
        ) {
          triggerAlert({
            severity: 'critical',
            domain: 'health',
            title: '응급실 수용률 임계',
            message: `응급실 수용률 ${next.peakOccupancy}% 구간 감지. 권역 분산 이송이 필요합니다.`,
            coordinates: next.focus,
          });
          lastAlertAt.current = now;
        }
      }
    };

    const timer = setInterval(tick, UPDATE_INTERVAL_MS);
    tick();

    return () => clearInterval(timer);
  }, [triggerAlert, updateLayerData]);
}
