'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

// 경찰서/소방서 위치 데이터 (한국 주요 도시)
const STATIONS: Array<{
  id: string;
  type: 'police' | 'fire';
  name: string;
  coordinates: [number, number];
}> = [
  // 경찰서
  { id: 'police-jongno', type: 'police', name: '종로경찰서', coordinates: [126.981, 37.572] },
  { id: 'police-gangnam', type: 'police', name: '강남경찰서', coordinates: [127.047, 37.517] },
  { id: 'police-mapo', type: 'police', name: '마포경찰서', coordinates: [126.951, 37.548] },
  { id: 'police-yeongdeungpo', type: 'police', name: '영등포경찰서', coordinates: [126.896, 37.524] },
  { id: 'police-busan-jung', type: 'police', name: '부산중부경찰서', coordinates: [129.034, 35.107] },
  { id: 'police-daegu-jung', type: 'police', name: '대구중부경찰서', coordinates: [128.597, 35.870] },
  { id: 'police-incheon', type: 'police', name: '인천중부경찰서', coordinates: [126.705, 37.456] },
  // 소방서
  { id: 'fire-jongno', type: 'fire', name: '종로소방서', coordinates: [126.993, 37.580] },
  { id: 'fire-gangnam', type: 'fire', name: '강남소방서', coordinates: [127.031, 37.504] },
  { id: 'fire-seongdong', type: 'fire', name: '성동소방서', coordinates: [127.036, 37.563] },
  { id: 'fire-busan', type: 'fire', name: '부산중앙소방서', coordinates: [129.042, 35.115] },
  { id: 'fire-daejeon', type: 'fire', name: '대전중앙소방서', coordinates: [127.385, 36.328] },
  { id: 'fire-gwangju', type: 'fire', name: '광주동부소방서', coordinates: [126.924, 35.150] },
];

// 출동 시뮬레이션 경로 (경찰서/소방서 → 사건현장)
interface DispatchRoute {
  id: string;
  stationId: string;
  type: 'police' | 'fire';
  label: string;
  etaMin: number;
  path: [number, number][];
  target: { name: string; coordinates: [number, number] };
}

const DISPATCH_ROUTES: DispatchRoute[] = [
  {
    id: 'dispatch-police-gangnam-1',
    stationId: 'police-gangnam',
    type: 'police',
    label: '112 출동: 강남 교차로',
    etaMin: 4,
    path: [
      [127.047, 37.517], [127.036, 37.513], [127.028, 37.508],
      [127.021, 37.502], [127.015, 37.497],
    ],
    target: { name: '강남역 사거리', coordinates: [127.015, 37.497] },
  },
  {
    id: 'dispatch-fire-jongno-1',
    stationId: 'fire-jongno',
    type: 'fire',
    label: '119 출동: 종로 화재',
    etaMin: 6,
    path: [
      [126.993, 37.580], [126.989, 37.575], [126.984, 37.570],
      [126.978, 37.565], [126.972, 37.560], [126.967, 37.555],
    ],
    target: { name: '종로3가', coordinates: [126.967, 37.555] },
  },
  {
    id: 'dispatch-fire-gangnam-1',
    stationId: 'fire-gangnam',
    type: 'fire',
    label: '119 출동: 서초 구조',
    etaMin: 5,
    path: [
      [127.031, 37.504], [127.024, 37.499], [127.018, 37.493],
      [127.011, 37.488], [127.005, 37.483],
    ],
    target: { name: '서초역 부근', coordinates: [127.005, 37.483] },
  },
  {
    id: 'dispatch-police-busan-1',
    stationId: 'police-busan-jung',
    type: 'police',
    label: '112 출동: 부산역 부근',
    etaMin: 5,
    path: [
      [129.034, 35.107], [129.040, 35.112], [129.048, 35.118],
      [129.055, 35.124], [129.060, 35.130],
    ],
    target: { name: '부산역 광장', coordinates: [129.060, 35.130] },
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

function buildStationGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: STATIONS.map((station) => ({
      type: 'Feature' as const,
      id: station.id,
      geometry: {
        type: 'Point' as const,
        coordinates: station.coordinates,
      },
      properties: {
        id: station.id,
        name: station.name,
        stationType: station.type,
        status: 'operational',
      },
    })),
  };
}

function buildDispatchVehicleGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 30000; // 30초 주기
  return {
    type: 'FeatureCollection',
    features: DISPATCH_ROUTES.map((route, i) => {
      const offset = (i * 5003) % cycleDuration;
      const t = Math.min(((time + offset) % cycleDuration) / cycleDuration, 1);
      const pos = interpolate(route.path, t);
      const arrived = t > 0.95;
      const remainingMin = Math.max(0, Math.round(route.etaMin * (1 - t)));

      return {
        type: 'Feature' as const,
        id: route.id,
        geometry: {
          type: 'Point' as const,
          coordinates: pos,
        },
        properties: {
          id: route.id,
          label: route.label,
          dispatchType: route.type,
          etaMin: remainingMin,
          arrived,
          targetName: route.target.name,
          stationId: route.stationId,
        },
      };
    }),
  };
}

function buildDispatchRouteGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 30000;
  return {
    type: 'FeatureCollection',
    features: DISPATCH_ROUTES.map((route, i) => {
      const offset = (i * 5003) % cycleDuration;
      const t = Math.min(((time + offset) % cycleDuration) / cycleDuration, 1);
      // 이미 지나간 경로만 표시
      const n = route.path.length - 1;
      const currentIdx = Math.min(Math.floor(t * n), n - 1);
      const currentPos = interpolate(route.path, t);
      const traveled = [...route.path.slice(0, currentIdx + 1), currentPos];

      return {
        type: 'Feature' as const,
        id: `route-${route.id}`,
        geometry: {
          type: 'LineString' as const,
          coordinates: traveled,
        },
        properties: {
          id: route.id,
          dispatchType: route.type,
          etaMin: Math.max(0, Math.round(route.etaMin * (1 - t))),
        },
      };
    }),
  };
}

function buildTargetGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: DISPATCH_ROUTES.map((route) => ({
      type: 'Feature' as const,
      id: `target-${route.id}`,
      geometry: {
        type: 'Point' as const,
        coordinates: route.target.coordinates,
      },
      properties: {
        id: `target-${route.id}`,
        name: route.target.name,
        dispatchType: route.type,
        type: 'incident',
      },
    })),
  };
}

export function useDispatchLayer() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const selectObject = useAppStore((s) => s.selectObject);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const registered = useRef(false);
  const arrivedSet = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!registered.current) {
      const onClick = (layerId: string, domain: 'crime' | 'health', type: string) => (feature: GeoJSON.Feature) =>
        selectObject(toSelectedObjectFromFeature(feature, { id: layerId, domain, type }));

      // 경찰서/소방서 위치
      addLayer({
        id: 'dispatch-stations',
        domain: 'crime',
        name: '경찰서/소방서',
        type: 'marker',
        visible: false,
        data: buildStationGeoJSON(),
        style: { color: '#f59e0b', radius: 600 },
        onClick: onClick('dispatch-stations', 'crime', 'marker'),
      });

      // 사건 현장
      addLayer({
        id: 'dispatch-targets',
        domain: 'crime',
        name: '출동 대상지',
        type: 'marker',
        visible: false,
        data: buildTargetGeoJSON(),
        style: { color: '#ef4444', radius: 500, animated: true },
        onClick: onClick('dispatch-targets', 'crime', 'marker'),
      });

      // 출동 차량
      addLayer({
        id: 'dispatch-vehicles',
        domain: 'crime',
        name: '출동 차량',
        type: 'marker',
        visible: false,
        data: buildDispatchVehicleGeoJSON(0),
        style: { color: '#3b82f6', radius: 350 },
        onClick: onClick('dispatch-vehicles', 'crime', 'marker'),
      });

      // 출동 경로
      addLayer({
        id: 'dispatch-routes',
        domain: 'crime',
        name: '출동 경로',
        type: 'line',
        visible: false,
        data: buildDispatchRouteGeoJSON(0),
        style: { color: '#3b82f6', lineWidth: 3, opacity: 0.7 },
        onClick: onClick('dispatch-routes', 'crime', 'line'),
      });

      registered.current = true;
    }

    const interval = setInterval(() => {
      const state = useAppStore.getState().layers;
      const vehiclesVisible = state['dispatch-vehicles']?.visible;
      const routesVisible = state['dispatch-routes']?.visible;
      if (!vehiclesVisible && !routesVisible) return;

      const now = Date.now();
      const vehicleData = buildDispatchVehicleGeoJSON(now);
      if (vehiclesVisible) updateLayerData('dispatch-vehicles', vehicleData);
      if (routesVisible) updateLayerData('dispatch-routes', buildDispatchRouteGeoJSON(now));

      // 도착 알림
      for (const feature of vehicleData.features) {
        const props = feature.properties as Record<string, unknown>;
        const id = props.id as string;
        if (props.arrived && !arrivedSet.current.has(id)) {
          arrivedSet.current.add(id);
          triggerAlert({
            severity: 'info',
            domain: (props.dispatchType as string) === 'police' ? 'crime' : 'health',
            title: `출동 완료: ${props.targetName}`,
            message: `${props.label} 현장 도착 완료.`,
            coordinates: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
          });
          // 30초 후 리셋하여 다시 출동 가능
          setTimeout(() => arrivedSet.current.delete(id), 30000);
        }
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [addLayer, selectObject, updateLayerData, triggerAlert]);
}
