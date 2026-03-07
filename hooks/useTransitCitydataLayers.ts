'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

interface CitydataAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  crowd?: GeoJSON.FeatureCollection;
  subway?: GeoJSON.FeatureCollection;
  bus?: GeoJSON.FeatureCollection;
  sbike?: GeoJSON.FeatureCollection;
  warnings?: string[];
}

const QUERY_KEY = ['transit', 'citydata'] as const;
const REFRESH_INTERVAL_MS = 5 * 60_000; // 5분

const LAYER_DEFS = [
  {
    id: 'transit-crowd-density',
    name: '인구 혼잡도',
    type: 'heatmap' as const,
    style: { radius: 40, opacity: 0.8 },
    dataKey: 'crowd' as const,
  },
  {
    id: 'transit-subway-passengers',
    name: '지하철 혼잡역',
    type: 'marker' as const,
    style: { color: '#0052A4', radius: 500, opacity: 0.9 },
    dataKey: 'subway' as const,
  },
  {
    id: 'transit-bus-passengers',
    name: '버스 혼잡 정류소',
    type: 'marker' as const,
    style: { color: '#53b332', radius: 400, opacity: 0.9 },
    dataKey: 'bus' as const,
  },
  {
    id: 'transit-sbike',
    name: '따릉이 현황',
    type: 'marker' as const,
    style: { color: '#f59e0b', radius: 350, opacity: 0.9 },
    dataKey: 'sbike' as const,
  },
] as const;

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchCitydata(): Promise<CitydataAPIResponse> {
  const response = await fetch('/api/transit/citydata', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load transit citydata: ${response.status}`);
  }
  return (await response.json()) as CitydataAPIResponse;
}

export function useTransitCitydataLayers() {
  const addLayer = useAppStore((s) => s.addLayer);
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const selectObject = useAppStore((s) => s.selectObject);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const registered = useRef(false);
  const seenWarnings = useRef<Set<string>>(new Set());

  // 레이어 초기 등록
  useEffect(() => {
    if (registered.current) return;
    registered.current = true;

    for (const def of LAYER_DEFS) {
      addLayer({
        id: def.id,
        domain: 'transit',
        name: def.name,
        type: def.type,
        visible: false,
        data: { type: 'FeatureCollection', features: [] },
        style: def.style,
        ...(def.type === 'marker'
          ? {
              onClick: (feature: GeoJSON.Feature) =>
                selectObject(
                  toSelectedObjectFromFeature(feature, {
                    id: def.id,
                    domain: 'transit',
                    type: def.type,
                  }),
                ),
            }
          : {}),
      });
    }
  }, [addLayer, selectObject]);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchCitydata,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  usePolling([...QUERY_KEY], REFRESH_INTERVAL_MS);

  // 데이터 동기화
  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setDomainDataSource('transit', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `transit:citydata:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Transit:citydata] ${warning}`);
      }
    }

    for (const def of LAYER_DEFS) {
      const data = payload[def.dataKey];
      if (!isFeatureCollection(data)) continue;
      setLayerDataSource(def.id, source);
      updateLayerData(def.id, data);
    }
  }, [query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
