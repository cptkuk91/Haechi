'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

const LAYER_ID = 'vulnerable-elderly-welfare-facilities';

interface ElderlyWelfareAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

function toBboxParam(bounds: { west: number; south: number; east: number; north: number } | null): string | null {
  if (!bounds) return null;
  return [
    bounds.west.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.north.toFixed(5),
  ].join(',');
}

async function fetchElderlyWelfare(maxCount: number, bboxParam: string | null): Promise<ElderlyWelfareAPIResponse> {
  const params = new URLSearchParams({ max: String(maxCount) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/vulnerable/elderly-welfare-facilities?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load elderly welfare facilities: ${response.status}`);
  }
  return (await response.json()) as ElderlyWelfareAPIResponse;
}

function limitFeatureCount(data: GeoJSON.FeatureCollection, maxCount: number): GeoJSON.FeatureCollection {
  if (data.features.length <= maxCount) return data;
  return {
    ...data,
    features: data.features.slice(0, maxCount),
  };
}

export function useElderlyWelfareFacilitiesLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const visible = useAppStore((s) => s.layers[LAYER_ID]?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = toBboxParam(mapBounds);

  const sourceProbeQuery = useQuery({
    queryKey: ['vulnerable', 'elderly-welfare-facilities', 'source-probe'],
    queryFn: () => fetchElderlyWelfare(1, null),
    staleTime: 30 * 60_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  const query = useQuery({
    queryKey: ['vulnerable', 'elderly-welfare-facilities', bboxParam],
    queryFn: () => fetchElderlyWelfare(2000, bboxParam),
    staleTime: 30 * 60_000,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  // 시설 데이터는 변동 빈도가 낮아 30분 폴링으로 충분
  usePolling(['vulnerable', 'elderly-welfare-facilities', bboxParam], 30 * 60_000, visible);

  useEffect(() => {
    const payload = sourceProbeQuery.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(LAYER_ID, source);
    setDomainDataSource('vulnerable', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `elderly-welfare:probe:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Elderly:welfare:probe] ${warning}`);
      }
    }
  }, [setDomainDataSource, setLayerDataSource, sourceProbeQuery.data]);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(LAYER_ID, source);
    setDomainDataSource('vulnerable', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `elderly-welfare:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Elderly:welfare] ${warning}`);
      }
    }

    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;
    if (payload.data.features.length === 0) return;

    updateLayerData(LAYER_ID, limitFeatureCount(payload.data, 2000));
  }, [query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
