'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';

const UPDATE_INTERVAL_MS = 2500;
const ALERT_COOLDOWN_MS = 40_000;

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

function getFeatureAnchor(feature: GeoJSON.Feature): [number, number] | undefined {
  const geometry = feature.geometry;
  if (!geometry) return undefined;

  if (geometry.type === 'Point') {
    return [geometry.coordinates[0], geometry.coordinates[1]];
  }

  if (geometry.type === 'LineString' && geometry.coordinates[0]) {
    return [geometry.coordinates[0][0], geometry.coordinates[0][1]];
  }

  if (geometry.type === 'Polygon' && geometry.coordinates[0]?.[0]) {
    return [geometry.coordinates[0][0][0], geometry.coordinates[0][0][1]];
  }

  return undefined;
}

function updateTrafficLineCollection(args: {
  collection: GeoJSON.FeatureCollection;
  now: number;
  bias: number;
}): {
  collection: GeoJSON.FeatureCollection;
  maxCongestion: number;
  focusCoordinates?: [number, number];
} {
  let maxCongestion = 0;
  let focusCoordinates: [number, number] | undefined;

  const features = args.collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseCongestion = clamp(
      toNumber(props.baseCongestion) ?? toNumber(props.congestion) ?? 0.58 + index * 0.06 + args.bias,
      0.22,
      0.92
    );

    const wavePrimary = (Math.sin(args.now / 2500 + index * 0.9) + 1) / 2;
    const waveSecondary = (Math.sin(args.now / 5400 + index * 1.7) + 1) / 2;
    const congestion = clamp(baseCongestion * 0.55 + wavePrimary * 0.32 + waveSecondary * 0.18, 0.12, 0.98);

    const speedKph = Math.max(8, Math.round(112 - congestion * 94));
    const pulse = congestion > 0.7 ? 0.62 + wavePrimary * 0.35 : 0.35 + waveSecondary * 0.2;

    if (congestion > maxCongestion) {
      maxCongestion = congestion;
      focusCoordinates = getFeatureAnchor(feature);
    }

    return {
      ...feature,
      properties: {
        ...props,
        baseCongestion: Number(baseCongestion.toFixed(2)),
        congestion: Number(congestion.toFixed(2)),
        speedKph,
        pulse: Number(pulse.toFixed(2)),
        lineWidth: congestion >= 0.86 ? 6 : congestion >= 0.65 ? 5 : 4,
        status: congestion >= 0.86 ? 'jam' : congestion >= 0.65 ? 'slow' : 'free',
      },
    };
  });

  return {
    collection: {
      ...args.collection,
      features,
    },
    maxCongestion,
    focusCoordinates,
  };
}

function updateIncidentCollection(
  collection: GeoJSON.FeatureCollection,
  now: number
): {
  collection: GeoJSON.FeatureCollection;
  maxCongestion: number;
  focusCoordinates?: [number, number];
} {
  let maxCongestion = 0;
  let focusCoordinates: [number, number] | undefined;

  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseSpeed = clamp(toNumber(props.speedKph) ?? 35 - index * 4, 8, 90);
    const oscillation = Math.sin(now / 2200 + index * 0.8) * 11;
    const speedKph = Math.max(5, Math.round(baseSpeed + oscillation));
    const congestion = clamp((105 - speedKph) / 100, 0.1, 0.98);
    const severity =
      congestion >= 0.85
        ? 'critical'
        : congestion >= 0.65
          ? 'warning'
          : 'info';
    const pulse = severity === 'critical' ? 0.75 + ((Math.sin(now / 700 + index) + 1) / 2) * 0.25 : 0.45;

    if (congestion > maxCongestion) {
      maxCongestion = congestion;
      focusCoordinates = getFeatureAnchor(feature);
    }

    return {
      ...feature,
      properties: {
        ...props,
        speedKph,
        congestion: Number(congestion.toFixed(2)),
        severity,
        pulse: Number(pulse.toFixed(2)),
      },
    };
  });

  return {
    collection: {
      ...collection,
      features,
    },
    maxCongestion,
    focusCoordinates,
  };
}

export function useTrafficFlowLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const lastAlertAt = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const state = useAppStore.getState();
      const ls = state.layers;

      let maxCongestion = 0;
      let focusCoordinates: [number, number] | undefined;

      const bottleneckLayer = ls['highway-bottleneck'];
      const bottleneckData = bottleneckLayer?.visible ? bottleneckLayer.data : null;
      if (bottleneckData) {
        const next = updateTrafficLineCollection({
          collection: bottleneckData,
          now,
          bias: 0.06,
        });
        updateLayerData('highway-bottleneck', next.collection);
        maxCongestion = Math.max(maxCongestion, next.maxCongestion);
        focusCoordinates = next.focusCoordinates ?? focusCoordinates;
      }

      const rerouteLayer = ls['highway-reroute'];
      const rerouteData = rerouteLayer?.visible ? rerouteLayer.data : null;
      if (rerouteData) {
        const next = updateTrafficLineCollection({
          collection: rerouteData,
          now: now + 900,
          bias: -0.12,
        });
        updateLayerData('highway-reroute', next.collection);
      }

      const incidentLayer = ls['highway-incidents'];
      const incidentData = incidentLayer?.visible ? incidentLayer.data : null;
      if (incidentData) {
        const next = updateIncidentCollection(incidentData, now);
        updateLayerData('highway-incidents', next.collection);
        if (next.maxCongestion > maxCongestion) {
          maxCongestion = next.maxCongestion;
          focusCoordinates = next.focusCoordinates ?? focusCoordinates;
        }
      }

      if (
        maxCongestion >= 0.9 &&
        focusCoordinates &&
        now - lastAlertAt.current > ALERT_COOLDOWN_MS
      ) {
        triggerAlert({
          severity: 'critical',
          domain: 'highway',
          title: '실시간 교통 임계 정체',
          message: `고속도로 혼잡도 ${Math.round(maxCongestion * 100)}% 구간 감지. 우회 경로 검토가 필요합니다.`,
          coordinates: focusCoordinates,
        });
        lastAlertAt.current = now;
      }
    };

    const timer = setInterval(tick, UPDATE_INTERVAL_MS);
    tick();

    return () => clearInterval(timer);
  }, [triggerAlert, updateLayerData]);
}
