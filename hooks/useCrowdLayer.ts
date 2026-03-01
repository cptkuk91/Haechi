'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';

// 군중 밀집 시뮬레이션 — 주요 밀집 지역
const CROWD_HOTSPOTS: Array<{
  name: string;
  center: [number, number];
  basePopulation: number; // 기본 인구 밀도
  variance: number; // 시간대별 변동 폭
  peakHour: number; // 피크 시간 (0-23)
}> = [
  { name: '강남역', center: [127.0276, 37.4979], basePopulation: 800, variance: 400, peakHour: 18 },
  { name: '홍대입구', center: [126.9246, 37.5571], basePopulation: 700, variance: 500, peakHour: 21 },
  { name: '명동', center: [126.9860, 37.5636], basePopulation: 600, variance: 350, peakHour: 15 },
  { name: '잠실 롯데월드', center: [127.1026, 37.5126], basePopulation: 500, variance: 300, peakHour: 14 },
  { name: '신촌 연세로', center: [126.9368, 37.5597], basePopulation: 550, variance: 350, peakHour: 20 },
  { name: '이태원', center: [126.9944, 37.5344], basePopulation: 650, variance: 500, peakHour: 22 },
  { name: '동대문 DDP', center: [127.0094, 37.5674], basePopulation: 450, variance: 250, peakHour: 16 },
  { name: '여의도 IFC', center: [126.9256, 37.5251], basePopulation: 600, variance: 300, peakHour: 12 },
  { name: '광화문', center: [126.9769, 37.5712], basePopulation: 500, variance: 300, peakHour: 13 },
  { name: '서울역', center: [126.9707, 37.5547], basePopulation: 700, variance: 350, peakHour: 8 },
  // 부산
  { name: '해운대', center: [129.1604, 35.1587], basePopulation: 500, variance: 400, peakHour: 15 },
  { name: '서면', center: [129.0589, 35.1578], basePopulation: 450, variance: 300, peakHour: 19 },
  // 기타 도시
  { name: '대구 동성로', center: [128.5933, 35.8687], basePopulation: 400, variance: 250, peakHour: 18 },
  { name: '인천 송도', center: [126.6603, 37.3916], basePopulation: 350, variance: 200, peakHour: 17 },
  { name: '대전 유성', center: [127.3361, 36.3554], basePopulation: 300, variance: 200, peakHour: 19 },
];

// 포인트 주변에 밀집도 포인트를 산포
function generateScatterPoints(
  center: [number, number],
  population: number,
  count: number
): Array<{ coordinates: [number, number]; weight: number }> {
  const points: Array<{ coordinates: [number, number]; weight: number }> = [];
  for (let i = 0; i < count; i++) {
    // 가우시안 분포 근사
    const angle = Math.random() * 2 * Math.PI;
    const r = Math.sqrt(-2 * Math.log(Math.random())) * 0.005; // ~500m 반경
    const lng = center[0] + r * Math.cos(angle);
    const lat = center[1] + r * Math.sin(angle);
    const weight = (population / count) * (0.5 + Math.random());
    points.push({ coordinates: [lng, lat], weight });
  }
  return points;
}

function buildCrowdGeoJSON(time: number): GeoJSON.FeatureCollection {
  // 시뮬레이션 시간 (실제 시간 기반 + 가속)
  const simHour = ((time / 3000) % 24); // 3초 = 1시간 (72초 = 하루)
  const allPoints: GeoJSON.Feature[] = [];

  for (const hotspot of CROWD_HOTSPOTS) {
    // 시간대별 밀집도 계산 (피크 시간에 최대)
    const hourDiff = Math.abs(simHour - hotspot.peakHour);
    const normalizedDiff = Math.min(hourDiff, 24 - hourDiff) / 12; // 0~1
    const timeFactor = 1 - normalizedDiff;
    const population = hotspot.basePopulation + hotspot.variance * timeFactor;

    // 위험 레벨 판단
    const dangerThreshold = hotspot.basePopulation + hotspot.variance * 0.8;
    const isDangerous = population > dangerThreshold;

    const pointCount = Math.floor(population / 30); // ~20-40 포인트
    const scatterPoints = generateScatterPoints(hotspot.center, population, pointCount);

    for (const pt of scatterPoints) {
      allPoints.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: pt.coordinates,
        },
        properties: {
          weight: pt.weight,
          hotspot: hotspot.name,
          population: Math.round(population),
          dangerous: isDangerous,
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features: allPoints,
  };
}

export function useCrowdLayer() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const registered = useRef(false);
  const lastAlertTime = useRef(0);

  useEffect(() => {
    if (!registered.current) {
      addLayer({
        id: 'crowd-density',
        domain: 'transit',
        name: '군중 밀집도',
        type: 'heatmap',
        visible: false,
        data: buildCrowdGeoJSON(0),
        style: { radius: 40, opacity: 0.8 },
      });
      registered.current = true;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const data = buildCrowdGeoJSON(now);
      updateLayerData('crowd-density', data);

      // 위험 밀집 구역 경보 (30초마다 최대 1회)
      if (now - lastAlertTime.current > 30000) {
        const dangerous = data.features.find((f) => f.properties?.dangerous);
        if (dangerous && dangerous.properties) {
          triggerAlert({
            severity: 'warning',
            domain: 'transit',
            title: '군중 밀집 경고',
            message: `${dangerous.properties.hotspot} 인근 인구 밀집도 위험 수준 (${dangerous.properties.population}명/㎢). 안전 관리 필요.`,
            coordinates: (dangerous.geometry as GeoJSON.Point).coordinates as [number, number],
          });
          lastAlertTime.current = now;
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [addLayer, updateLayerData, triggerAlert]);
}
