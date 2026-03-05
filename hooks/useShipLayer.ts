'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

// 시뮬레이션 선박 항로 (한국 근해)
const SHIP_ROUTES: Array<{
  name: string;
  mmsi: string;
  type: 'cargo' | 'tanker' | 'passenger' | 'fishing';
  tonnage: number;
  speed: number; // knots
  path: [number, number][];
}> = [
  {
    name: 'HANJIN BUSAN', mmsi: '440001001', type: 'cargo', tonnage: 85000, speed: 18,
    path: [[129.10, 34.80], [129.05, 35.05], [129.04, 35.11]], // 부산 입항
  },
  {
    name: 'HYUNDAI DREAM', mmsi: '440002002', type: 'cargo', tonnage: 72000, speed: 16,
    path: [[129.04, 35.11], [128.90, 34.90], [128.50, 34.60], [127.70, 34.20]], // 부산 출항 남해
  },
  {
    name: 'SK ENERGY 1', mmsi: '440003003', type: 'tanker', tonnage: 120000, speed: 14,
    path: [[126.50, 37.20], [126.55, 37.35], [126.60, 37.44]], // 인천 입항
  },
  {
    name: 'POSCO CARRIER', mmsi: '440004004', type: 'cargo', tonnage: 95000, speed: 17,
    path: [[129.50, 35.80], [129.40, 36.00], [129.38, 36.03]], // 포항 입항
  },
  {
    name: 'JEJU DREAM', mmsi: '440005005', type: 'passenger', tonnage: 15000, speed: 22,
    path: [[126.57, 34.40], [126.55, 34.00], [126.53, 33.52]], // 목포→제주
  },
  {
    name: 'BLUE PEARL', mmsi: '440006006', type: 'passenger', tonnage: 12000, speed: 20,
    path: [[126.53, 33.52], [126.55, 34.00], [126.57, 34.40]], // 제주→목포
  },
  {
    name: 'DAEWOO ULSAN', mmsi: '440007007', type: 'cargo', tonnage: 110000, speed: 15,
    path: [[129.60, 35.30], [129.45, 35.45], [129.39, 35.51]], // 울산 입항
  },
  {
    name: 'HANIL EXPRESS', mmsi: '440008008', type: 'cargo', tonnage: 65000, speed: 16,
    path: [[127.80, 34.50], [127.75, 34.70], [127.70, 34.91]], // 광양 입항
  },
  {
    name: 'SEOHAEJIN 3', mmsi: '440009009', type: 'fishing', tonnage: 500, speed: 8,
    path: [[125.80, 36.00], [125.90, 36.10], [126.00, 36.20], [126.10, 36.10], [125.80, 36.00]], // 서해 어선
  },
  {
    name: 'DONGHAE 7', mmsi: '440010010', type: 'fishing', tonnage: 400, speed: 7,
    path: [[129.50, 37.00], [129.60, 37.10], [129.70, 37.00], [129.60, 36.90], [129.50, 37.00]], // 동해 어선
  },
  {
    name: 'NAMHAE STAR', mmsi: '440011011', type: 'fishing', tonnage: 300, speed: 6,
    path: [[128.00, 34.30], [128.10, 34.40], [128.20, 34.30], [128.10, 34.20], [128.00, 34.30]], // 남해 어선
  },
  {
    name: 'GLOBAL TRADER', mmsi: '350001001', type: 'cargo', tonnage: 150000, speed: 19,
    path: [[131.00, 34.00], [130.00, 34.50], [129.20, 35.00], [129.05, 35.10]], // 원양→부산
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

function buildShipGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 90000; // 90초 주기
  return {
    type: 'FeatureCollection',
    features: SHIP_ROUTES.map((ship, i) => {
      const offset = (i * 8831) % cycleDuration;
      const t = ((time + offset) % cycleDuration) / cycleDuration;
      const pos = interpolate(ship.path, t);
      const heading = getHeading(ship.path, t);

      return {
        type: 'Feature' as const,
        id: `ship-${i}`,
        geometry: {
          type: 'Point' as const,
          coordinates: pos,
        },
        properties: {
          name: ship.name,
          mmsi: ship.mmsi,
          shipType: ship.type,
          tonnage: ship.tonnage,
          speed: ship.speed,
          heading,
        },
      };
    }),
  };
}

function buildShipTrailGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 90000;
  const trailPoints = 8;
  return {
    type: 'FeatureCollection',
    features: SHIP_ROUTES.map((ship, i) => {
      const offset = (i * 8831) % cycleDuration;
      const t = ((time + offset) % cycleDuration) / cycleDuration;
      const coords: [number, number][] = [];
      for (let j = trailPoints; j >= 0; j--) {
        coords.push(interpolate(ship.path, Math.max(0, t - j * 0.015)));
      }
      return {
        type: 'Feature' as const,
        id: `ship-trail-${i}`,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: { name: ship.name, shipType: ship.type },
      };
    }),
  };
}

export function useShipLayer() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const selectObject = useAppStore((s) => s.selectObject);
  const registered = useRef(false);

  useEffect(() => {
    if (!registered.current) {
      addLayer({
        id: 'ship-ais-live',
        domain: 'maritime',
        name: '실시간 선박 (AIS)',
        type: 'marker',
        visible: false,
        data: buildShipGeoJSON(0),
        style: { color: '#06b6d4', radius: 450, opacity: 1 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'ship-ais-live',
              domain: 'maritime',
              type: 'marker',
            })
          ),
      });
      addLayer({
        id: 'ship-trails',
        domain: 'maritime',
        name: '선박 항적',
        type: 'line',
        visible: false,
        data: buildShipTrailGeoJSON(0),
        style: { color: [6, 182, 212, 80], lineWidth: 2 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'ship-trails',
              domain: 'maritime',
              type: 'line',
            })
          ),
      });
      registered.current = true;
    }

    const interval = setInterval(() => {
      const state = useAppStore.getState().layers;
      const shipVisible = state['ship-ais-live']?.visible;
      const trailVisible = state['ship-trails']?.visible;
      if (!shipVisible && !trailVisible) return;

      const now = Date.now();
      if (shipVisible) updateLayerData('ship-ais-live', buildShipGeoJSON(now));
      if (trailVisible) updateLayerData('ship-trails', buildShipTrailGeoJSON(now));
    }, 3000);

    return () => clearInterval(interval);
  }, [addLayer, selectObject, updateLayerData]);
}
