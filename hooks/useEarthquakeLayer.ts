'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePolling } from '@/hooks/usePolling';
import { useAppStore } from '@/stores/app-store';

interface EarthquakeAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  totalCount?: number;
  period?: {
    start: string;
    end: string;
  };
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
}

const QUERY_KEY = ['disaster', 'earthquake'] as const;
const REFRESH_INTERVAL_MS = 60_000;
const SOURCE_PROBE_INTERVAL_MS = 10 * 60_000;

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchEarthquakeData(): Promise<EarthquakeAPIResponse> {
  const response = await fetch('/api/disaster/earthquake', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load earthquake data: ${response.status}`);
  }
  return (await response.json()) as EarthquakeAPIResponse;
}

async function fetchEarthquakeSourceProbe(): Promise<EarthquakeAPIResponse> {
  const response = await fetch('/api/disaster/earthquake?sourceOnly=1', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to probe earthquake source: ${response.status}`);
  }
  return (await response.json()) as EarthquakeAPIResponse;
}

export function useEarthquakeLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const layerReady = useAppStore((s) => Boolean(s.layers['disaster-earthquake-ripple']));
  const visible = useAppStore((s) => s.layers['disaster-earthquake-ripple']?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());

  const sourceProbeQuery = useQuery({
    queryKey: ['disaster', 'earthquake', 'source-probe', 'v1'],
    queryFn: fetchEarthquakeSourceProbe,
    staleTime: SOURCE_PROBE_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchEarthquakeData,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  usePolling(['disaster', 'earthquake', 'source-probe', 'v1'], SOURCE_PROBE_INTERVAL_MS, visible);
  usePolling([...QUERY_KEY], REFRESH_INTERVAL_MS, visible);

  useEffect(() => {
    const payload = sourceProbeQuery.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('disaster-earthquake-ripple', source);
    setDomainDataSource('disaster', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `disaster:earthquake:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Disaster:earthquake] ${warning}`);
      }
    }
  }, [setDomainDataSource, setLayerDataSource, sourceProbeQuery.data]);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('disaster-earthquake-ripple', source);
    setDomainDataSource('disaster', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `disaster:earthquake:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Disaster:earthquake] ${warning}`);
      }
    }

    if (!layerReady) return;
    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;

    updateLayerData('disaster-earthquake-ripple', payload.data);
  }, [layerReady, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
