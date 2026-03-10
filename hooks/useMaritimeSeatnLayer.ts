'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface MaritimeSeatnAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
  meta?: {
    tnzone?: string;
    featureCount?: number;
    radiusCount?: number;
  };
}

const QUERY_KEY = ['maritime', 'seatn', '04'] as const;
const REFRESH_INTERVAL_MS = 12 * 60 * 60_000;

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchMaritimeSeatn(): Promise<MaritimeSeatnAPIResponse> {
  const url = new URL('/api/maritime/seatn', window.location.origin);
  url.searchParams.set('tnzone', '04');
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load maritime seatn layer: ${response.status}`);
  }
  return (await response.json()) as MaritimeSeatnAPIResponse;
}

export function useMaritimeSeatnLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const layerState = useAppStore((s) => s.layers['maritime-seatn-zones']);
  const layerReady = Boolean(layerState);
  const layerVisible = Boolean(layerState?.visible);
  const seenWarnings = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchMaritimeSeatn,
    enabled: layerReady && layerVisible,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  usePolling(QUERY_KEY, REFRESH_INTERVAL_MS, layerReady && layerVisible);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('maritime-seatn-zones', source);
    setDomainDataSource('maritime', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `maritime:seatn:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Maritime:seatn] ${warning}`);
      }
    }

    if (!layerReady || !layerVisible) return;
    if (!isFeatureCollection(payload.data)) return;
    updateLayerData('maritime-seatn-zones', payload.data);
  }, [layerReady, layerVisible, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
