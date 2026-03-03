'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface NoFlyZoneAPIResponse {
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

async function fetchNoFlyZones(): Promise<NoFlyZoneAPIResponse> {
  const response = await fetch('/api/aviation/no-fly', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load no-fly zones: ${response.status}`);
  }

  return (await response.json()) as NoFlyZoneAPIResponse;
}

export function useNoFlyZonesLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const seenWarnings = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['aviation', 'no-fly'],
    queryFn: fetchNoFlyZones,
    staleTime: 10 * 60_000,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  // 공역 경계는 변화가 잦지 않으므로 10분 폴링
  usePolling(['aviation', 'no-fly'], 10 * 60_000);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('no-fly-zones', source);
    setDomainDataSource('aviation', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `aviation:no-fly:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Aviation:no-fly] ${warning}`);
      }
    }

    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;
    if (payload.data.features.length === 0) return;

    updateLayerData('no-fly-zones', payload.data);
  }, [query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
