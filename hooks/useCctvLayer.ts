'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface CctvAPIResponse {
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

async function fetchCctvData(maxCount: number, bboxParam: string | null): Promise<CctvAPIResponse> {
  const params = new URLSearchParams({ max: String(maxCount) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/cctv/positions?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load cctv positions: ${response.status}`);
  }
  return (await response.json()) as CctvAPIResponse;
}

function limitFeatureCount(data: GeoJSON.FeatureCollection, maxCount: number): GeoJSON.FeatureCollection {
  if (data.features.length <= maxCount) return data;
  return {
    ...data,
    features: data.features.slice(0, maxCount),
  };
}

export function useCctvLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const cctvMaxDisplayCount = useAppStore((s) => s.cctvMaxDisplayCount);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const cctvVisible = useAppStore((s) => s.layers['cctv-markers']?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = toBboxParam(mapBounds);

  const query = useQuery({
    queryKey: ['cctv', 'positions', cctvMaxDisplayCount, bboxParam],
    queryFn: () => fetchCctvData(cctvMaxDisplayCount, bboxParam),
    staleTime: 10 * 60_000,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: cctvVisible,
  });

  // CCTV 위치 데이터는 변동 빈도가 낮아 10분 폴링으로 충분
  usePolling(['cctv', 'positions', cctvMaxDisplayCount, bboxParam], 10 * 60_000, cctvVisible);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('cctv-markers', source);
    setDomainDataSource('cctv', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `cctv:positions:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[CCTV:positions] ${warning}`);
      }
    }

    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;
    if (payload.data.features.length === 0) return;

    updateLayerData('cctv-markers', limitFeatureCount(payload.data, cctvMaxDisplayCount));
  }, [cctvMaxDisplayCount, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
