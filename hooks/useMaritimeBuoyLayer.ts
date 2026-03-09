'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';
import {
  formatMaritimeBuoyBbox,
  getMaritimeBuoyFeatureLimitForZoom,
} from '@/lib/maritime-buoys';

interface MaritimeBuoyAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
  meta?: {
    featureLimit?: number;
    featureCount?: number;
  };
}

const QUERY_KEY = ['maritime', 'buoys'] as const;
const REFRESH_INTERVAL_MS = 12 * 60 * 60_000;

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchMaritimeBuoys(): Promise<MaritimeBuoyAPIResponse> {
  const { mapBounds, camera } = useAppStore.getState();
  const url = new URL('/api/maritime/buoys', window.location.origin);
  const limit = getMaritimeBuoyFeatureLimitForZoom(camera.zoom);
  const bboxParam = formatMaritimeBuoyBbox(mapBounds);
  url.searchParams.set('limit', String(limit));
  if (bboxParam) {
    url.searchParams.set('bbox', bboxParam);
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load maritime buoy layer: ${response.status}`);
  }
  return (await response.json()) as MaritimeBuoyAPIResponse;
}

export function useMaritimeBuoyLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const layerState = useAppStore((s) => s.layers['maritime-buoy-locations']);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const zoom = useAppStore((s) => s.camera.zoom);
  const layerReady = Boolean(layerState);
  const layerVisible = Boolean(layerState?.visible);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = formatMaritimeBuoyBbox(mapBounds);
  const limit = getMaritimeBuoyFeatureLimitForZoom(zoom);

  const query = useQuery({
    queryKey: [...QUERY_KEY, bboxParam ?? 'no-bbox', limit],
    queryFn: fetchMaritimeBuoys,
    enabled: layerReady && layerVisible,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  usePolling([...QUERY_KEY, bboxParam ?? 'no-bbox', limit], REFRESH_INTERVAL_MS, layerReady && layerVisible);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('maritime-buoy-locations', source);
    setDomainDataSource('maritime', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `maritime:buoys:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Maritime:buoys] ${warning}`);
      }
    }

    if (!layerReady || !layerVisible) return;
    if (!isFeatureCollection(payload.data)) return;
    updateLayerData('maritime-buoy-locations', payload.data);
  }, [layerReady, layerVisible, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
