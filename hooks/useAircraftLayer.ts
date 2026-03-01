'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

// 시뮬레이션 항공기 비행 경로 (한국 상공)
const FLIGHT_PATHS: Array<{
  callsign: string;
  type: 'passenger' | 'cargo' | 'helicopter';
  altitude: number; // feet
  speed: number; // knots
  path: [number, number][];
}> = [
  {
    callsign: 'KE901', type: 'passenger', altitude: 35000, speed: 480,
    path: [[126.44, 37.46], [126.80, 37.20], [127.50, 36.50], [128.60, 35.88], [129.04, 35.12]], // 인천→부산
  },
  {
    callsign: 'OZ321', type: 'passenger', altitude: 33000, speed: 460,
    path: [[129.04, 35.12], [128.30, 35.90], [127.40, 36.70], [126.80, 37.30], [126.44, 37.46]], // 부산→인천
  },
  {
    callsign: 'KE115', type: 'passenger', altitude: 38000, speed: 500,
    path: [[126.44, 37.46], [125.50, 37.80], [124.00, 38.50], [122.00, 39.00], [120.00, 39.50]], // 인천→중국방면
  },
  {
    callsign: 'JL92', type: 'passenger', altitude: 36000, speed: 490,
    path: [[132.00, 37.00], [130.50, 36.50], [129.50, 36.00], [128.00, 35.50], [126.44, 37.46]], // 일본→인천
  },
  {
    callsign: 'TW201', type: 'passenger', altitude: 31000, speed: 440,
    path: [[126.97, 37.55], [126.79, 35.14], [126.53, 33.50]], // 서울→제주
  },
  {
    callsign: 'TW202', type: 'passenger', altitude: 32000, speed: 440,
    path: [[126.53, 33.50], [126.80, 35.20], [126.97, 37.55]], // 제주→서울
  },
  {
    callsign: 'KE703', type: 'cargo', altitude: 28000, speed: 420,
    path: [[126.44, 37.46], [127.00, 37.00], [127.80, 36.00], [128.80, 35.20], [129.04, 35.12]], // 화물
  },
  {
    callsign: 'H-101', type: 'helicopter', altitude: 3000, speed: 120,
    path: [[126.95, 37.57], [126.98, 37.54], [127.00, 37.52], [127.03, 37.50], [127.05, 37.48]], // 서울 상공 헬기
  },
  {
    callsign: 'LJ501', type: 'passenger', altitude: 34000, speed: 470,
    path: [[126.72, 35.96], [127.10, 36.50], [127.40, 37.00], [126.97, 37.55]], // 전주→서울 방면
  },
  {
    callsign: 'KE505', type: 'passenger', altitude: 37000, speed: 485,
    path: [[126.49, 33.51], [127.00, 34.50], [128.00, 35.50], [129.00, 36.50], [129.40, 37.50]], // 제주→동해방면
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

function buildGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 60000; // 60초 주기로 전체 경로 반복
  return {
    type: 'FeatureCollection',
    features: FLIGHT_PATHS.map((flight, i) => {
      // 각 항공기마다 다른 위상으로 시작
      const offset = (i * 7919) % cycleDuration;
      const t = ((time + offset) % cycleDuration) / cycleDuration;
      const pos = interpolate(flight.path, t);
      const heading = getHeading(flight.path, t);

      return {
        type: 'Feature' as const,
        id: `aircraft-${i}`,
        geometry: {
          type: 'Point' as const,
          coordinates: pos,
        },
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

function buildTrailGeoJSON(time: number): GeoJSON.FeatureCollection {
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
        geometry: {
          type: 'LineString' as const,
          coordinates: coords,
        },
        properties: { callsign: flight.callsign },
      };
    }),
  };
}

export function useAircraftLayer() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const selectObject = useAppStore((s) => s.selectObject);
  const registered = useRef(false);

  useEffect(() => {
    if (!registered.current) {
      addLayer({
        id: 'aircraft-live',
        domain: 'aviation',
        name: '실시간 항공기',
        type: 'marker',
        visible: false,
        data: buildGeoJSON(0),
        style: { color: '#00f0ff', radius: 300, opacity: 1 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'aircraft-live',
              domain: 'aviation',
              type: 'marker',
            })
          ),
      });
      addLayer({
        id: 'aircraft-trails',
        domain: 'aviation',
        name: '항공기 궤적',
        type: 'line',
        visible: false,
        data: buildTrailGeoJSON(0),
        style: { color: [0, 240, 255, 100], lineWidth: 2 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'aircraft-trails',
              domain: 'aviation',
              type: 'line',
            })
          ),
      });
      registered.current = true;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      updateLayerData('aircraft-live', buildGeoJSON(now));
      updateLayerData('aircraft-trails', buildTrailGeoJSON(now));
    }, 2000);

    return () => clearInterval(interval);
  }, [addLayer, selectObject, updateLayerData]);
}
