'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface MissingLocationsResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  totalCount?: number;
  matchedCount?: number;
  warnings?: string[];
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchMissingLocations(): Promise<MissingLocationsResponse> {
  const response = await fetch('/api/vulnerable/missing-locations', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load missing locations: ${response.status}`);
  }
  return (await response.json()) as MissingLocationsResponse;
}

async function fetchMissingLocationsSourceProbe(): Promise<MissingLocationsResponse> {
  const response = await fetch('/api/vulnerable/missing-locations?sourceOnly=1', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to probe missing locations source: ${response.status}`);
  }
  return (await response.json()) as MissingLocationsResponse;
}

export function useMissingPersonsLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const visible = useAppStore((s) => s.layers['vulnerable-missing-persons']?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());

  // 토글 OFF 상태에서도 source 확인 (완료 표시용)
  const sourceProbeQuery = useQuery({
    queryKey: ['vulnerable', 'missing-locations', 'source-probe', 'v2'],
    queryFn: fetchMissingLocationsSourceProbe,
    staleTime: 30 * 60_000,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  const query = useQuery({
    queryKey: ['vulnerable', 'missing-locations'],
    queryFn: fetchMissingLocations,
    staleTime: 30 * 60_000,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  // 실종 데이터는 변동 빈도가 낮아 30분 폴링
  usePolling(['vulnerable', 'missing-locations'], 30 * 60_000, visible);

  // source probe → 완료 표시만 설정
  useEffect(() => {
    const payload = sourceProbeQuery.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('vulnerable-missing-persons', source);
    setDomainDataSource('vulnerable', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `missing:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Missing:locations] ${warning}`);
      }
    }
  }, [setDomainDataSource, setLayerDataSource, sourceProbeQuery.data]);

  // 실제 데이터 → 레이어 업데이트
  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('vulnerable-missing-persons', source);
    setDomainDataSource('vulnerable', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `missing:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Missing:locations] ${warning}`);
      }
    }

    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;
    if (payload.data.features.length === 0) return;

    updateLayerData('vulnerable-missing-persons', payload.data);
  }, [query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
