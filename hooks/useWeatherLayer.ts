'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';

const UPDATE_INTERVAL_MS = 3000;
const ALERT_COOLDOWN_MS = 45_000;

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
  return undefined;
}

function updateRainColumn(
  collection: GeoJSON.FeatureCollection,
  now: number
): {
  collection: GeoJSON.FeatureCollection;
  maxRain: number;
  focus?: [number, number];
} {
  let maxRain = 0;
  let focus: [number, number] | undefined;

  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseRain = toNumber(props.baseRainMm) ?? toNumber(props.rainMm) ?? 45 + index * 7;
    const dynamic = (Math.sin(now / 3300 + index) + 1) * 9 + (Math.cos(now / 7200 + index * 1.2) + 1) * 4;
    const rainMm = clamp(Math.round(baseRain * 0.65 + dynamic), 10, 92);
    const threshold = toNumber(props.threshold) ?? 50;
    const intensity = clamp(Math.round((rainMm / Math.max(threshold, 1)) * 850), 240, 1550);
    const severity = rainMm >= threshold + 18 ? 'critical' : rainMm >= threshold ? 'warning' : 'info';

    if (rainMm > maxRain) {
      maxRain = rainMm;
      focus = toPointCoordinates(feature);
    }

    return {
      ...feature,
      properties: {
        ...props,
        baseRainMm: Number(baseRain.toFixed(1)),
        rainMm,
        intensity,
        severity,
      },
    };
  });

  return {
    collection: {
      ...collection,
      features,
    },
    maxRain,
    focus,
  };
}

function updateRainHeat(
  collection: GeoJSON.FeatureCollection,
  now: number
): GeoJSON.FeatureCollection {
  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseWeight = toNumber(props.baseWeight) ?? toNumber(props.weight) ?? 0.55;
    const wave = (Math.sin(now / 3900 + index * 0.9) + 1) / 2;
    const weight = clamp(baseWeight * 0.55 + wave * 0.7, 0.05, 1.4);
    const rainMm = Math.round(weight * 62);

    return {
      ...feature,
      properties: {
        ...props,
        baseWeight: Number(baseWeight.toFixed(2)),
        weight: Number(weight.toFixed(2)),
        rainMm,
      },
    };
  });

  return {
    ...collection,
    features,
  };
}

function updateWindParticles(
  collection: GeoJSON.FeatureCollection,
  now: number
): GeoJSON.FeatureCollection {
  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseWind = toNumber(props.baseWindKph) ?? toNumber(props.windKph) ?? 18 + index * 2;
    const gust = Math.sin(now / 2800 + index * 1.4) * 7 + Math.cos(now / 6100 + index) * 3;
    const windKph = clamp(Math.round(baseWind + gust), 4, 46);
    const direction = ((toNumber(props.direction) ?? 75 + index * 15) + Math.sin(now / 5200 + index) * 18 + 360) % 360;

    return {
      ...feature,
      properties: {
        ...props,
        baseWindKph: Number(baseWind.toFixed(1)),
        windKph,
        direction: Math.round(direction),
        speedKph: windKph,
      },
    };
  });

  return {
    ...collection,
    features,
  };
}

export function useWeatherLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const lastAlertAt = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const state = useAppStore.getState();
      const ls = state.layers;

      const rainColumnLayer = ls['weather-rainfall-column'];
      const rainColumns = rainColumnLayer?.visible ? rainColumnLayer.data : null;
      if (rainColumns) {
        const next = updateRainColumn(rainColumns, now);
        updateLayerData('weather-rainfall-column', next.collection);

        if (
          next.maxRain >= 74 &&
          next.focus &&
          now - lastAlertAt.current > ALERT_COOLDOWN_MS
        ) {
          triggerAlert({
            severity: 'critical',
            domain: 'weather',
            title: '강수 임계치 초과',
            message: `시간당 강수량 ${next.maxRain}mm 감지. 재난 연계 대응을 준비하세요.`,
            coordinates: next.focus,
          });
          lastAlertAt.current = now;
        }
      }

      const rainHeatLayer = ls['weather-rainfall-heat'];
      if (rainHeatLayer?.visible && rainHeatLayer.data) {
        updateLayerData('weather-rainfall-heat', updateRainHeat(rainHeatLayer.data, now));
      }

      const windLayer = ls['weather-wind-particles'];
      if (windLayer?.visible && windLayer.data) {
        updateLayerData('weather-wind-particles', updateWindParticles(windLayer.data, now));
      }
    };

    const timer = setInterval(tick, UPDATE_INTERVAL_MS);
    tick();

    return () => clearInterval(timer);
  }, [triggerAlert, updateLayerData]);
}
