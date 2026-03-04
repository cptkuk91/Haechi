'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface HealthEmergencyRoomsAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
}

const QUERY_KEY = ['health', 'emergency-rooms'] as const;
const REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchHealthEmergencyRooms(): Promise<HealthEmergencyRoomsAPIResponse> {
  const response = await fetch('/api/health/emergency-rooms', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load health emergency rooms: ${response.status}`);
  }
  return (await response.json()) as HealthEmergencyRoomsAPIResponse;
}

export function useHealthEmergencyRoomsLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const layerReady = useAppStore((s) => Boolean(s.layers['health-emergency-room-location']));
  const seenWarnings = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchHealthEmergencyRooms,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  usePolling([...QUERY_KEY], REFRESH_INTERVAL_MS);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('health-emergency-room-location', source);
    setDomainDataSource('health', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `health:emergency-rooms:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Health:emergency-rooms] ${warning}`);
      }
    }

    if (!layerReady) return;
    if (!isFeatureCollection(payload.data)) return;
    updateLayerData('health-emergency-room-location', payload.data);
  }, [layerReady, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
