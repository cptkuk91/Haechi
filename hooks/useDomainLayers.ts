'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import type { LayerConfig } from '@/types/domain';

// Data imports
import { getCCTVGeoJSON } from '@/data/cctv';
import { getNoFlyZonesGeoJSON, getMDLGeoJSON, getKADIZGeoJSON, getUXOZonesGeoJSON } from '@/data/defense';
import { getPortsGeoJSON, getDangerZonesGeoJSON, getVTSGeoJSON, getVTSCoverageGeoJSON } from '@/data/maritime';
import { getKTXRoutesGeoJSON, getSubwayRoutesGeoJSON, getStationsGeoJSON } from '@/data/transit';

/**
 * Phase 2 도메인 레이어 등록 훅
 * 마운트 시 모든 정적 데이터 레이어를 store에 등록한다.
 */
export function useDomainLayers() {
  const addLayer = useAppStore((s) => s.addLayer);

  useEffect(() => {
    const layers: LayerConfig[] = [
      // ── CCTV (도메인 2.2) ──
      {
        id: 'cctv-markers',
        domain: 'cctv',
        name: 'CCTV 위치',
        type: 'marker',
        visible: false,
        data: getCCTVGeoJSON(),
        style: { color: '#00ff88', radius: 400, opacity: 0.9 },
      },

      // ── 항공/국방 (도메인 2.1, 2.4) ──
      {
        id: 'no-fly-zones',
        domain: 'aviation',
        name: '비행금지구역',
        type: 'polygon',
        visible: false,
        data: getNoFlyZonesGeoJSON(),
        style: { color: '#ff3344', opacity: 0.25, elevation: 3000 },
      },
      {
        id: 'mdl-boundary',
        domain: 'defense',
        name: '군사분계선(MDL)/NLL',
        type: 'line',
        visible: false,
        data: getMDLGeoJSON(),
        style: { color: '#ff3344', lineWidth: 4 },
      },
      {
        id: 'kadiz-boundary',
        domain: 'defense',
        name: 'KADIZ 방공식별구역',
        type: 'polygon',
        visible: false,
        data: getKADIZGeoJSON(),
        style: { color: [255, 51, 68, 30], opacity: 0.15 },
      },
      {
        id: 'uxo-zones',
        domain: 'defense',
        name: '불발탄(UXO) 경고구역',
        type: 'polygon',
        visible: false,
        data: getUXOZonesGeoJSON(),
        style: { color: '#f59e0b', opacity: 0.35 },
      },

      // ── 해양 (도메인 2.7) ──
      {
        id: 'port-terminals',
        domain: 'maritime',
        name: '항만 터미널',
        type: 'marker',
        visible: false,
        data: getPortsGeoJSON(),
        style: { color: '#06b6d4', radius: 600, opacity: 0.9 },
      },
      {
        id: 'maritime-danger',
        domain: 'maritime',
        name: '해양 위험구역',
        type: 'polygon',
        visible: false,
        data: getDangerZonesGeoJSON(),
        style: { color: '#f97316', opacity: 0.3 },
      },
      {
        id: 'vts-centers',
        domain: 'maritime',
        name: 'VTS 관제센터',
        type: 'marker',
        visible: false,
        data: getVTSGeoJSON(),
        style: { color: '#3b82f6', radius: 500, opacity: 0.9 },
      },
      {
        id: 'vts-coverage',
        domain: 'maritime',
        name: 'VTS 관제구역',
        type: 'polygon',
        visible: false,
        data: getVTSCoverageGeoJSON(),
        style: { color: [6, 182, 212, 40], opacity: 0.15 },
      },

      // ── 대중교통 (도메인 2.9) ──
      {
        id: 'ktx-routes',
        domain: 'transit',
        name: 'KTX 노선',
        type: 'line',
        visible: false,
        data: getKTXRoutesGeoJSON(),
        style: { color: '#0052A4', lineWidth: 4 },
      },
      {
        id: 'subway-routes',
        domain: 'transit',
        name: '수도권 지하철',
        type: 'line',
        visible: false,
        data: getSubwayRoutesGeoJSON(),
        style: { color: '#00A84D', lineWidth: 3 },
      },
      {
        id: 'train-stations',
        domain: 'transit',
        name: '역사(주요역)',
        type: 'marker',
        visible: false,
        data: getStationsGeoJSON(),
        style: { color: '#8b5cf6', radius: 350, opacity: 0.9 },
      },
    ];

    layers.forEach((layer) => addLayer(layer));
  }, [addLayer]);
}
