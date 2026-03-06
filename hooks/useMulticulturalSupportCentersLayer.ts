'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

const LAYER_ID = 'vulnerable-multicultural-support-centers';

interface MulticulturalSupportCenterAPIResponse {
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

async function fetchMulticulturalSupportCenters(
  maxCount: number,
  bboxParam: string | null
): Promise<MulticulturalSupportCenterAPIResponse> {
  const params = new URLSearchParams({ max: String(maxCount) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/vulnerable/multicultural-support-centers?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load multicultural support centers: ${response.status}`);
  }
  return (await response.json()) as MulticulturalSupportCenterAPIResponse;
}

async function fetchMulticulturalSupportCentersSourceProbe(): Promise<MulticulturalSupportCenterAPIResponse> {
  const response = await fetch('/api/vulnerable/multicultural-support-centers?sourceOnly=1', {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to probe multicultural support centers source: ${response.status}`);
  }
  return (await response.json()) as MulticulturalSupportCenterAPIResponse;
}

function limitFeatureCount(data: GeoJSON.FeatureCollection, maxCount: number): GeoJSON.FeatureCollection {
  if (data.features.length <= maxCount) return data;
  return {
    ...data,
    features: data.features.slice(0, maxCount),
  };
}

export function useMulticulturalSupportCentersLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const visible = useAppStore((s) => s.layers[LAYER_ID]?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = toBboxParam(mapBounds);

  const sourceProbeQuery = useQuery({
    queryKey: ['vulnerable', 'multicultural-support-centers', 'source-probe'],
    queryFn: fetchMulticulturalSupportCentersSourceProbe,
    staleTime: 30 * 60_000,
    retry: 1,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const query = useQuery({
    queryKey: ['vulnerable', 'multicultural-support-centers', bboxParam],
    queryFn: () => fetchMulticulturalSupportCenters(2000, bboxParam),
    staleTime: 30 * 60_000,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  usePolling(['vulnerable', 'multicultural-support-centers', bboxParam], 30 * 60_000, visible);

  useEffect(() => {
    const payload = sourceProbeQuery.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(LAYER_ID, source);
    setDomainDataSource('vulnerable', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `multicultural:probe:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Multicultural:support:center:probe] ${warning}`);
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
        const key = `multicultural:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Multicultural:support:center] ${warning}`);
      }
    }

    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;
    if (payload.data.features.length === 0) return;

    updateLayerData(LAYER_ID, limitFeatureCount(payload.data, 2000));
  }, [query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
