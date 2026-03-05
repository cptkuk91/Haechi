'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

// KTX/SRT 열차 시뮬레이션 경로
const TRAIN_SERVICES: Array<{
  trainNo: string;
  type: 'KTX' | 'SRT' | 'subway';
  line: string;
  color: string;
  path: [number, number][];
}> = [
  {
    trainNo: 'KTX-101', type: 'KTX', line: '경부선', color: '#0052A4',
    path: [
      [126.9707, 37.5547], [127.0557, 37.4162], [127.1060, 37.0114],
      [127.4341, 36.3324], [128.6255, 35.8770], [129.0410, 35.1151],
    ],
  },
  {
    trainNo: 'KTX-102', type: 'KTX', line: '경부선', color: '#0052A4',
    path: [
      [129.0410, 35.1151], [128.6255, 35.8770], [127.4341, 36.3324],
      [127.1060, 37.0114], [127.0557, 37.4162], [126.9707, 37.5547],
    ],
  },
  {
    trainNo: 'KTX-201', type: 'KTX', line: '호남선', color: '#009D3E',
    path: [
      [126.9707, 37.5547], [127.0557, 37.4162], [127.1271, 36.8085],
      [127.0983, 36.1870], [126.7130, 35.8312], [126.7924, 35.1374],
    ],
  },
  {
    trainNo: 'SRT-301', type: 'SRT', line: '수서-부산', color: '#A7132A',
    path: [
      [127.1040, 37.4875], [127.1060, 37.0114], [127.4341, 36.3324],
      [128.6255, 35.8770], [129.0410, 35.1151],
    ],
  },
  {
    trainNo: 'SRT-302', type: 'SRT', line: '수서-부산', color: '#A7132A',
    path: [
      [129.0410, 35.1151], [128.6255, 35.8770], [127.4341, 36.3324],
      [127.1060, 37.0114], [127.1040, 37.4875],
    ],
  },
  // 수도권 지하철 (대표 열차 몇 개)
  {
    trainNo: 'L2-001', type: 'subway', line: '2호선', color: '#00A84D',
    path: [
      [126.9726, 37.5581], [127.0094, 37.5674], [127.0368, 37.5614],
      [127.0567, 37.5184], [127.1001, 37.5145], [127.0276, 37.4979],
      [126.9527, 37.4849], [126.9015, 37.4849], [126.8951, 37.5088],
      [126.9246, 37.5571], [126.9726, 37.5581],
    ],
  },
  {
    trainNo: 'L2-002', type: 'subway', line: '2호선', color: '#00A84D',
    path: [
      [127.0276, 37.4979], [126.9527, 37.4849], [126.9015, 37.4849],
      [126.8951, 37.5088], [126.9246, 37.5571], [126.9726, 37.5581],
      [127.0094, 37.5674], [127.0368, 37.5614], [127.0567, 37.5184],
      [127.1001, 37.5145], [127.0276, 37.4979],
    ],
  },
  {
    trainNo: 'L1-001', type: 'subway', line: '1호선', color: '#0052A4',
    path: [
      [127.0614, 37.6553], [127.0469, 37.5806], [127.0094, 37.5674],
      [126.9724, 37.5700], [126.9707, 37.5547],
    ],
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

function buildTrainGeoJSON(time: number): GeoJSON.FeatureCollection {
  const ktxCycle = 45000; // 45초 경부선 주기
  const subwayCycle = 30000; // 30초 순환선 주기

  return {
    type: 'FeatureCollection',
    features: TRAIN_SERVICES.map((train, i) => {
      const cycle = train.type === 'subway' ? subwayCycle : ktxCycle;
      const offset = (i * 6173) % cycle;
      const t = ((time + offset) % cycle) / cycle;
      const pos = interpolate(train.path, t);

      // 랜덤 지연 시뮬레이션 (10% 확률)
      const delayed = ((time + i * 1000) % 100000) < 10000;

      return {
        type: 'Feature' as const,
        id: `train-${i}`,
        geometry: {
          type: 'Point' as const,
          coordinates: pos,
        },
        properties: {
          trainNo: train.trainNo,
          trainType: train.type,
          line: train.line,
          color: train.color,
          delayed,
          delayMinutes: delayed ? Math.floor(((time + i) % 15) + 1) : 0,
        },
      };
    }),
  };
}

export function useTrainLayer() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const selectObject = useAppStore((s) => s.selectObject);
  const registered = useRef(false);

  useEffect(() => {
    if (!registered.current) {
      addLayer({
        id: 'train-live',
        domain: 'transit',
        name: '실시간 열차 위치',
        type: 'marker',
        visible: false,
        data: buildTrainGeoJSON(0),
        style: { color: '#8b5cf6', radius: 350, opacity: 1 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'train-live',
              domain: 'transit',
              type: 'marker',
            })
          ),
      });
      registered.current = true;
    }

    const interval = setInterval(() => {
      if (!useAppStore.getState().layers['train-live']?.visible) return;

      updateLayerData('train-live', buildTrainGeoJSON(Date.now()));
    }, 2000);

    return () => clearInterval(interval);
  }, [addLayer, selectObject, updateLayerData]);
}
