'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';

const UPDATE_INTERVAL_MS = 3200;
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

function updateAmberRadius(collection: GeoJSON.FeatureCollection, now: number): GeoJSON.FeatureCollection {
  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseRadius = toNumber(props.baseRadiusKm) ?? toNumber(props.radiusKm) ?? 1.9 + index * 0.5;
    const elapsedMinBase = toNumber(props.baseElapsedMin) ?? toNumber(props.elapsedMin) ?? 7 + index * 4;
    const elapsedMin = elapsedMinBase + ((now / 1000 + index * 11) % 35);
    const radiusKm = clamp(baseRadius + elapsedMin / 22, 1.2, 5.8);
    const intensity = Math.round(clamp(radiusKm * 330, 380, 1680));

    return {
      ...feature,
      properties: {
        ...props,
        baseRadiusKm: Number(baseRadius.toFixed(2)),
        baseElapsedMin: Number(elapsedMinBase.toFixed(1)),
        radiusKm: Number(radiusKm.toFixed(2)),
        elapsedMin: Math.round(elapsedMin),
        intensity,
      },
    };
  });

  return {
    ...collection,
    features,
  };
}

function updateIot(collection: GeoJSON.FeatureCollection, now: number): {
  collection: GeoJSON.FeatureCollection;
  maxHeartbeat: number;
  focus?: [number, number];
} {
  let maxHeartbeat = 0;
  let focus: [number, number] | undefined;

  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const baseHeartbeat = toNumber(props.baseHeartbeatMin) ?? toNumber(props.lastHeartbeatMin) ?? 18 + index * 9;
    const drift = (Math.sin(now / 4100 + index * 0.8) + 1) * 10 + (Math.cos(now / 8600 + index) + 1) * 4;
    const lastHeartbeatMin = Math.round(clamp(baseHeartbeat + drift, 6, 62));
    const status =
      lastHeartbeatMin >= 45
        ? 'no-signal'
        : lastHeartbeatMin >= 30
          ? 'warning'
          : 'normal';

    if (lastHeartbeatMin > maxHeartbeat) {
      maxHeartbeat = lastHeartbeatMin;
      focus = toPointCoordinates(feature);
    }

    return {
      ...feature,
      properties: {
        ...props,
        baseHeartbeatMin: Number(baseHeartbeat.toFixed(1)),
        lastHeartbeatMin,
        status,
      },
    };
  });

  return {
    collection: {
      ...collection,
      features,
    },
    maxHeartbeat,
    focus,
  };
}

function updateSupportLink(collection: GeoJSON.FeatureCollection, now: number): GeoJSON.FeatureCollection {
  const features = collection.features.map((feature, index) => {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const pulse = clamp(0.45 + ((Math.sin(now / 1200 + index) + 1) / 2) * 0.62, 0.2, 1.2);

    return {
      ...feature,
      properties: {
        ...props,
        pulse: Number(pulse.toFixed(2)),
        lineWidth: pulse > 0.9 ? 4 : 3,
      },
    };
  });

  return {
    ...collection,
    features,
  };
}

export function useVulnerableLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const lastAlertAt = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const state = useAppStore.getState();

      const amber = state.layers['vulnerable-amber-radius']?.data;
      if (amber) {
        updateLayerData('vulnerable-amber-radius', updateAmberRadius(amber, now));
      }

      const iot = state.layers['vulnerable-emergency-iot']?.data;
      if (iot) {
        const next = updateIot(iot, now);
        updateLayerData('vulnerable-emergency-iot', next.collection);

        if (
          next.maxHeartbeat >= 48 &&
          next.focus &&
          now - lastAlertAt.current > ALERT_COOLDOWN_MS
        ) {
          triggerAlert({
            severity: 'critical',
            domain: 'vulnerable',
            title: '사회적 약자 응급 알림',
            message: `IoT 무응답 ${next.maxHeartbeat}분 경과. 인근 CCTV/의료 레이어 연동 확인이 필요합니다.`,
            coordinates: next.focus,
          });
          lastAlertAt.current = now;
        }
      }

      const support = state.layers['vulnerable-support-link']?.data;
      if (support) {
        updateLayerData('vulnerable-support-link', updateSupportLink(support, now));
      }
    };

    const timer = setInterval(tick, UPDATE_INTERVAL_MS);
    tick();

    return () => clearInterval(timer);
  }, [triggerAlert, updateLayerData]);
}
