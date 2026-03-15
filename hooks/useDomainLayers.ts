'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import type { LayerConfig } from '@/types/domain';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

// Data imports
import { getNoFlyZonesGeoJSON, getMDLGeoJSON, getKADIZGeoJSON, getUXOZonesGeoJSON } from '@/data/defense';

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

/**
 * Phase 2 도메인 레이어 등록 훅
 * 마운트 시 모든 정적 데이터 레이어를 store에 등록한다.
 */
export function useDomainLayers() {
  const addLayer = useAppStore((s) => s.addLayer);
  const selectObject = useAppStore((s) => s.selectObject);

  useEffect(() => {
    const layers: LayerConfig[] = [
      // ── CCTV (도메인 2.2) ──
      {
        id: 'traffic-cctv-markers',
        domain: 'cctv',
        name: '교통관제 CCTV',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#00ff88', radius: 380, opacity: 0.95 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'traffic-cctv-markers',
              domain: 'cctv',
              type: 'marker',
            })
          ),
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
        id: 'maritime-ulsan-port-facilities',
        domain: 'maritime',
        name: '울산항 항만시설',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#fb7185', radius: 440, opacity: 0.94 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'maritime-ulsan-port-facilities',
              domain: 'maritime',
              type: 'marker',
            })
          ),
      },
      {
        id: 'maritime-ulsan-anchorages',
        domain: 'maritime',
        name: '울산항 정박지',
        type: 'polygon',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: [16, 185, 129, 72], opacity: 0.32 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'maritime-ulsan-anchorages',
              domain: 'maritime',
              type: 'polygon',
            })
          ),
      },
      {
        id: 'maritime-seatn-zones',
        domain: 'maritime',
        name: '해상사격훈련구역',
        type: 'polygon',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: [245, 158, 11, 72], opacity: 0.38 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'maritime-seatn-zones',
              domain: 'maritime',
              type: 'polygon',
            })
          ),
      },
      {
        id: 'maritime-seafog-stations',
        domain: 'maritime',
        name: '해무관측소',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#f59e0b', radius: 520, opacity: 0.95 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'maritime-seafog-stations',
              domain: 'maritime',
              type: 'marker',
            })
          ),
      },
      {
        id: 'maritime-buoy-locations',
        domain: 'maritime',
        name: '항로표지 위치',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#06b6d4', radius: 430, opacity: 0.92 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'maritime-buoy-locations',
              domain: 'maritime',
              type: 'marker',
            })
          ),
      },

      // ── 국가 인프라 (실데이터 placeholder) ──
      {
        id: 'infra-public-facility-safety',
        domain: 'infra',
        name: '공공시설물 안전',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#f97316', radius: 550, opacity: 0.92 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'infra-public-facility-safety',
              domain: 'infra',
              type: 'marker',
            })
          ),
      },
      {
        id: 'infra-highway-tollgates',
        domain: 'infra',
        name: '도로공사 영업소',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#facc15', radius: 520, opacity: 0.92 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'infra-highway-tollgates',
              domain: 'infra',
              type: 'marker',
            })
          ),
      },

      // ── 보건/의료 (실데이터 placeholder) ──
      {
        id: 'health-emergency-room-location',
        domain: 'health',
        name: '응급실 위치',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#34d399', radius: 560, opacity: 0.92 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'health-emergency-room-location',
              domain: 'health',
              type: 'marker',
            })
          ),
      },
      {
        id: 'health-trauma-centers',
        domain: 'health',
        name: '외상센터',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#ef4444', radius: 580, opacity: 0.92 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'health-trauma-centers',
              domain: 'health',
              type: 'marker',
            })
          ),
      },
      {
        id: 'health-aed-locations',
        domain: 'health',
        name: '자동심장충격기(AED)',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#f97316', radius: 460, opacity: 0.92 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'health-aed-locations',
              domain: 'health',
              type: 'marker',
            })
          ),
      },
      {
        id: 'health-pharmacy-locations',
        domain: 'health',
        name: '약국 위치',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#38bdf8', radius: 440, opacity: 0.9 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'health-pharmacy-locations',
              domain: 'health',
              type: 'marker',
            })
          ),
      },
      {
        id: 'health-infectious-risk-sido',
        domain: 'health',
        name: '시도별 감염 위험도',
        type: 'polygon',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: [16, 185, 129, 96], opacity: 0.42 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'health-infectious-risk-sido',
              domain: 'health',
              type: 'polygon',
            })
          ),
      },
      {
        id: 'health-infectious-trends',
        domain: 'health',
        name: '기간별 감염 추세',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#14b8a6', radius: 0, opacity: 0 },
      },
      {
        id: 'health-infectious-distribution',
        domain: 'health',
        name: '감염병 상세 분포',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#f97316', radius: 0, opacity: 0 },
      },

      // ── 기상/대기 환경 (실데이터 placeholder) ──
      {
        id: 'weather-air-quality-stations',
        domain: 'weather',
        name: '대기질 측정소',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#60a5fa', radius: 430, opacity: 0.92 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'weather-air-quality-stations',
              domain: 'weather',
              type: 'marker',
            })
          ),
      },

      // ── 사회적 약자 (신규 메뉴 placeholder) ──
      {
        id: 'vulnerable-elderly-welfare-facilities',
        domain: 'vulnerable',
        name: '노인복지시설',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#ec4899', radius: 500, opacity: 0.9 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'vulnerable-elderly-welfare-facilities',
              domain: 'vulnerable',
              type: 'marker',
            })
          ),
      },
      {
        id: 'vulnerable-child-welfare-facilities',
        domain: 'vulnerable',
        name: '아동복지시설',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#ec4899', radius: 500, opacity: 0.9 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'vulnerable-child-welfare-facilities',
              domain: 'vulnerable',
              type: 'marker',
            })
          ),
      },
      {
        id: 'vulnerable-disabled-facilities',
        domain: 'vulnerable',
        name: '장애인 편의시설',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#ec4899', radius: 500, opacity: 0.9 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'vulnerable-disabled-facilities',
              domain: 'vulnerable',
              type: 'marker',
            })
          ),
      },
      {
        id: 'vulnerable-multicultural-support-centers',
        domain: 'vulnerable',
        name: '다문화가족지원센터',
        type: 'marker',
        visible: false,
        data: emptyFeatureCollection(),
        style: { color: '#ec4899', radius: 500, opacity: 0.9 },
        onClick: (feature) =>
          selectObject(
            toSelectedObjectFromFeature(feature, {
              id: 'vulnerable-multicultural-support-centers',
              domain: 'vulnerable',
              type: 'marker',
            })
          ),
      },
    ];

    layers.forEach((layer) => addLayer(layer));
  }, [addLayer, selectObject]);
}
