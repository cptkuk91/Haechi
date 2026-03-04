'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePolling } from '@/hooks/usePolling';
import { useAppStore } from '@/stores/app-store';

interface WildfireAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  totalCount?: number;
  matchedCount?: number;
  period?: {
    start: string;
    end: string;
  };
  warnings?: string[];
}

const QUERY_KEY = ['disaster', 'wildfire-locations'] as const;
const REFRESH_INTERVAL_MS = 6 * 60 * 60_000;
const SOURCE_PROBE_INTERVAL_MS = 30 * 60_000;

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchWildfireLocations(): Promise<WildfireAPIResponse> {
  const response = await fetch('/api/disaster/wildfire-locations', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load wildfire locations: ${response.status}`);
  }
  return (await response.json()) as WildfireAPIResponse;
}

async function fetchWildfireSourceProbe(): Promise<WildfireAPIResponse> {
  const response = await fetch('/api/disaster/wildfire-locations?sourceOnly=1', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to probe wildfire source: ${response.status}`);
  }
  return (await response.json()) as WildfireAPIResponse;
}

export function useWildfireLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const layerReady = useAppStore((s) => Boolean(s.layers['disaster-wildfire-points']));
  const visible = useAppStore((s) => s.layers['disaster-wildfire-points']?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());

  const sourceProbeQuery = useQuery({
    queryKey: ['disaster', 'wildfire-locations', 'source-probe', 'v2'],
    queryFn: fetchWildfireSourceProbe,
    staleTime: SOURCE_PROBE_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchWildfireLocations,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  usePolling(['disaster', 'wildfire-locations', 'source-probe', 'v2'], SOURCE_PROBE_INTERVAL_MS);
  usePolling([...QUERY_KEY], REFRESH_INTERVAL_MS, visible);

  useEffect(() => {
    const payload = sourceProbeQuery.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('disaster-wildfire-points', source);
    setDomainDataSource('disaster', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `disaster:wildfire:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Disaster:wildfire] ${warning}`);
      }
    }

  }, [setDomainDataSource, setLayerDataSource, sourceProbeQuery.data]);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('disaster-wildfire-points', source);
    setDomainDataSource('disaster', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `disaster:wildfire:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Disaster:wildfire] ${warning}`);
      }
    }

    if (!layerReady) return;
    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;
    if (payload.data.features.length === 0) return;

    updateLayerData('disaster-wildfire-points', payload.data);
  }, [layerReady, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
