'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';

const UPDATE_INTERVAL_MS = 3500;
const ALERT_COOLDOWN_MS = 50_000;

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

function toPointCoordinates(feature: GeoJSON.Feature): [number, number] | undefined {
  const geometry = feature.geometry;
  if (!geometry) return undefined;
  if (geometry.type === 'Point') return [geometry.coordinates[0], geometry.coordinates[1]];
  if (geometry.type === 'LineString' && geometry.coordinates[0]) {
    return [geometry.coordinates[0][0], geometry.coordinates[0][1]];
  }
  if (geometry.type === 'Polygon' && geometry.coordinates[0]?.[0]) {
    return [geometry.coordinates[0][0][0], geometry.coordinates[0][0][1]];
  }
  return undefined;
}

function updateWildfire(
  collection: GeoJSON.FeatureCollection,
  now: number
): {
  collection: GeoJSON.FeatureCollection;
  hottest: number;
  focus?: [number, number];
} {
  let hottest = 0;
  let focus: [number, number] | undefined;

  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseTemp = toNumber(props.baseTempC) ?? toNumber(props.tempC) ?? 360 + index * 18;
    const heat = Math.sin(now / 2600 + index) * 28 + Math.cos(now / 7400 + index * 1.2) * 12;
    const tempC = Math.round(clamp(baseTemp + heat, 290, 520));
    const spread =
      tempC >= 420 ? 'rapid' : tempC >= 360 ? 'moderate' : 'stable';
    const intensity = Math.round(clamp((tempC - 280) * 4.5, 200, 1500));

    if (tempC > hottest) {
      hottest = tempC;
      focus = toPointCoordinates(feature);
    }

    return {
      ...feature,
      properties: {
        ...props,
        baseTempC: Number(baseTemp.toFixed(1)),
        tempC,
        spread,
        intensity,
      },
    };
  });

  return {
    collection: {
      ...collection,
      features,
    },
    hottest,
    focus,
  };
}

function updateEarthquake(
  collection: GeoJSON.FeatureCollection,
  now: number
): {
  collection: GeoJSON.FeatureCollection;
  strongest: number;
  focus?: [number, number];
} {
  let strongest = 0;
  let focus: [number, number] | undefined;

  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseMagnitude = toNumber(props.baseMagnitude) ?? toNumber(props.magnitude) ?? 3.2;
    const ripple = Math.sin(now / 4100 + index * 0.7) * 0.7 + Math.cos(now / 9100 + index) * 0.45;
    const magnitude = Number(clamp(baseMagnitude + ripple, 2.6, 5.2).toFixed(1));
    const intensity = Math.round(clamp(magnitude * 240, 420, 1450));

    if (magnitude > strongest) {
      strongest = magnitude;
      focus = toPointCoordinates(feature);
    }

    return {
      ...feature,
      properties: {
        ...props,
        baseMagnitude: Number(baseMagnitude.toFixed(1)),
        magnitude,
        intensity,
      },
    };
  });

  return {
    collection: {
      ...collection,
      features,
    },
    strongest,
    focus,
  };
}

function updateFloodRisk(collection: GeoJSON.FeatureCollection, now: number): GeoJSON.FeatureCollection {
  const phase = (Math.sin(now / 6300) + 1) / 2;
  const level = phase > 0.82 ? 'warning' : phase > 0.6 ? 'watch' : 'normal';

  const features = collection.features.map((feature) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    return {
      ...feature,
      properties: {
        ...props,
        level,
        riverLevelPct: Math.round(52 + phase * 41),
      },
    };
  });

  return {
    ...collection,
    features,
  };
}

export function useDisasterLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const lastAlertAt = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const state = useAppStore.getState();

      const wildfire = state.layers['disaster-wildfire-points']?.data;
      const quake = state.layers['disaster-earthquake-ripple']?.data;
      const flood = state.layers['disaster-flood-risk']?.data;

      let hottest = 0;
      let strongest = 0;
      let focus: [number, number] | undefined;

      if (wildfire) {
        const next = updateWildfire(wildfire, now);
        updateLayerData('disaster-wildfire-points', next.collection);
        hottest = next.hottest;
        focus = next.focus ?? focus;
      }

      if (quake) {
        const next = updateEarthquake(quake, now);
        updateLayerData('disaster-earthquake-ripple', next.collection);
        if (next.strongest > strongest) {
          strongest = next.strongest;
          if (next.focus) focus = next.focus;
        }
      }

      if (flood) {
        updateLayerData('disaster-flood-risk', updateFloodRisk(flood, now));
      }

      if (
        now - lastAlertAt.current > ALERT_COOLDOWN_MS &&
        focus &&
        (hottest >= 430 || strongest >= 4.6)
      ) {
        triggerAlert({
          severity: 'critical',
          domain: 'disaster',
          title: '재난 도메인 임계 감지',
          message: `산불(${hottest}°C) 또는 지진(M${strongest.toFixed(1)}) 임계치 도달. 연쇄 대응이 필요합니다.`,
          coordinates: focus,
        });
        lastAlertAt.current = now;
      }
    };

    const timer = setInterval(tick, UPDATE_INTERVAL_MS);
    tick();

    return () => clearInterval(timer);
  }, [triggerAlert, updateLayerData]);
}
