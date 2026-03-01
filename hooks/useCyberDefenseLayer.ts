'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

// 사이버 공격 시뮬레이션 — 해외 → 한국 공격 빔
const CYBER_ATTACKS: Array<{
  source: [number, number]; // 공격 원점
  sourceName: string;
  target: [number, number]; // 타겟 (한국 내)
  targetName: string;
  attackType: 'ddos' | 'hack' | 'malware' | 'phishing';
}> = [
  { source: [116.40, 39.90], sourceName: '베이징', target: [126.98, 37.57], targetName: '서울 정부청사', attackType: 'ddos' },
  { source: [121.47, 31.23], sourceName: '상하이', target: [127.03, 37.50], targetName: '강남 데이터센터', attackType: 'hack' },
  { source: [103.85, 1.35], sourceName: '싱가포르', target: [129.04, 35.12], targetName: '부산 KT IDC', attackType: 'malware' },
  { source: [139.69, 35.69], sourceName: '도쿄', target: [126.73, 37.46], targetName: '인천 금융센터', attackType: 'phishing' },
  { source: [-77.04, 38.90], sourceName: '워싱턴DC', target: [127.10, 37.39], targetName: '판교 테크노밸리', attackType: 'hack' },
  { source: [37.62, 55.76], sourceName: '모스크바', target: [127.44, 36.33], targetName: '대전 정부통합센터', attackType: 'ddos' },
  { source: [114.17, 22.32], sourceName: '홍콩', target: [126.97, 37.55], targetName: '서울 통신망', attackType: 'malware' },
  { source: [2.35, 48.86], sourceName: '파리', target: [128.63, 35.88], targetName: '대구 IDC', attackType: 'phishing' },
];

// 영공 침범 시뮬레이션 경로
const INTRUSION_PATHS: Array<{
  name: string;
  type: 'hostile-aircraft' | 'ufo-drone';
  path: [number, number][];
}> = [
  {
    name: '미확인 항공기 A',
    type: 'hostile-aircraft',
    path: [[124.50, 38.50], [125.00, 38.20], [125.50, 37.90], [126.00, 37.80]],
  },
  {
    name: '비인가 드론 B',
    type: 'ufo-drone',
    path: [[126.50, 37.80], [126.60, 37.75], [126.70, 37.72], [126.80, 37.70]],
  },
  {
    name: '미확인 항공기 C',
    type: 'hostile-aircraft',
    path: [[131.00, 38.00], [130.50, 37.80], [130.00, 37.60], [129.50, 37.50]],
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

function buildCyberAttackGeoJSON(time: number): GeoJSON.FeatureCollection {
  // 활성 공격은 시간에 따라 변동 (모든 것을 항상 보여주지 않고 랜덤으로 활성)
  const activeCount = 3 + Math.floor((Math.sin(time / 5000) + 1) * 2.5); // 3~8개 활성
  const activeAttacks = CYBER_ATTACKS.slice(0, activeCount);

  return {
    type: 'FeatureCollection',
    features: activeAttacks.map((atk, i) => ({
      type: 'Feature' as const,
      id: `cyber-${i}`,
      geometry: {
        type: 'Point' as const,
        coordinates: atk.target,
      },
      properties: {
        source: atk.source,
        target: atk.target,
        sourceName: atk.sourceName,
        targetName: atk.targetName,
        attackType: atk.attackType,
        intensity: Math.floor(50 + Math.random() * 950), // 50~999 Gbps
      },
    })),
  };
}

function buildIntrusionGeoJSON(time: number): GeoJSON.FeatureCollection {
  const cycleDuration = 40000;
  return {
    type: 'FeatureCollection',
    features: INTRUSION_PATHS.map((intruder, i) => {
      const offset = (i * 13337) % cycleDuration;
      const t = ((time + offset) % cycleDuration) / cycleDuration;
      const pos = interpolate(intruder.path, t);

      return {
        type: 'Feature' as const,
        id: `intrusion-${i}`,
        geometry: {
          type: 'Point' as const,
          coordinates: pos,
        },
        properties: {
          name: intruder.name,
          intrusionType: intruder.type,
          threatLevel: intruder.type === 'hostile-aircraft' ? 'critical' : 'warning',
        },
      };
    }),
  };
}

export function useCyberDefenseLayer() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const selectObject = useAppStore((s) => s.selectObject);
  const registered = useRef(false);

  useEffect(() => {
    if (!registered.current) {
      addLayer({
        id: 'cyber-attacks',
        domain: 'cyber',
        name: '사이버 공격 빔',
        type: 'arc',
        visible: false,
        data: buildCyberAttackGeoJSON(0),
        style: { color: '#a855f7', lineWidth: 2 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'cyber-attacks',
              domain: 'cyber',
              type: 'arc',
            })
          ),
      });
      addLayer({
        id: 'defense-intrusion',
        domain: 'defense',
        name: '영공 침범 탐지',
        type: 'marker',
        visible: false,
        data: buildIntrusionGeoJSON(0),
        style: { color: '#ff3344', radius: 500, opacity: 1 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'defense-intrusion',
              domain: 'defense',
              type: 'marker',
            })
          ),
      });
      registered.current = true;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      updateLayerData('cyber-attacks', buildCyberAttackGeoJSON(now));
      updateLayerData('defense-intrusion', buildIntrusionGeoJSON(now));
    }, 2500);

    return () => clearInterval(interval);
  }, [addLayer, selectObject, updateLayerData]);
}
