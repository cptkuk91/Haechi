'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

const LAYER_ID = 'vulnerable-disabled-facilities';

interface DisabledFacilitiesAPIResponse {
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

async function fetchDisabledFacilities(maxCount: number, bboxParam: string | null): Promise<DisabledFacilitiesAPIResponse> {
  const params = new URLSearchParams({ max: String(maxCount) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/vulnerable/disabled-facilities?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load disabled facilities: ${response.status}`);
  }
  return (await response.json()) as DisabledFacilitiesAPIResponse;
}

async function fetchDisabledFacilitiesSourceProbe(): Promise<DisabledFacilitiesAPIResponse> {
  const response = await fetch('/api/vulnerable/disabled-facilities?sourceOnly=1', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to probe disabled facilities source: ${response.status}`);
  }
  return (await response.json()) as DisabledFacilitiesAPIResponse;
}

function limitFeatureCount(data: GeoJSON.FeatureCollection, maxCount: number): GeoJSON.FeatureCollection {
  if (data.features.length <= maxCount) return data;
  return {
    ...data,
    features: data.features.slice(0, maxCount),
  };
}

export function useDisabledFacilitiesLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const visible = useAppStore((s) => s.layers[LAYER_ID]?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = toBboxParam(mapBounds);

  const sourceProbeQuery = useQuery({
    queryKey: ['vulnerable', 'disabled-facilities', 'source-probe'],
    queryFn: fetchDisabledFacilitiesSourceProbe,
    staleTime: 30 * 60_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  const query = useQuery({
    queryKey: ['vulnerable', 'disabled-facilities', bboxParam],
    queryFn: () => fetchDisabledFacilities(5000, bboxParam),
    staleTime: 30 * 60_000,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  // 편의시설 데이터는 변동 빈도가 낮아 30분 폴링
  usePolling(['vulnerable', 'disabled-facilities', bboxParam], 30 * 60_000, visible);

  useEffect(() => {
    const payload = sourceProbeQuery.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(LAYER_ID, source);
    setDomainDataSource('vulnerable', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `disabled-facilities:probe:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Disabled:facilities:probe] ${warning}`);
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
        const key = `disabled-facilities:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Disabled:facilities] ${warning}`);
      }
    }

    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;

    updateLayerData(LAYER_ID, limitFeatureCount(payload.data, 5000));
  }, [query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
