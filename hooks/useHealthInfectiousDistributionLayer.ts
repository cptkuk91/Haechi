'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useAppStore,
  type HealthInfectiousDistributionData,
  type HealthInfectiousDistributionDiseaseOption,
} from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface HealthInfectiousDistributionFiltersResponse {
  availableYears: number[];
  selectedYear: number | null;
  diseaseOptions: HealthInfectiousDistributionDiseaseOption[];
}

interface HealthInfectiousDistributionAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: HealthInfectiousDistributionData | null;
  warnings?: string[];
  filters?: HealthInfectiousDistributionFiltersResponse;
}

const QUERY_KEY = ['health', 'infectious-distribution'] as const;
const REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

async function fetchHealthInfectiousDistribution(): Promise<HealthInfectiousDistributionAPIResponse> {
  const filters = useAppStore.getState().healthInfectiousDistributionFilters;
  const url = new URL('/api/health/infectious-distribution', window.location.origin);
  if (filters.year !== null) {
    url.searchParams.set('year', String(filters.year));
  }
  url.searchParams.set('metric', filters.metric);
  if (filters.disease) {
    url.searchParams.set('disease', filters.disease);
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load health infectious distribution: ${response.status}`);
  }
  return (await response.json()) as HealthInfectiousDistributionAPIResponse;
}

export function useHealthInfectiousDistributionLayer() {
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const setHealthInfectiousDistributionMeta = useAppStore((s) => s.setHealthInfectiousDistributionMeta);
  const setHealthInfectiousDistributionData = useAppStore((s) => s.setHealthInfectiousDistributionData);
  const filters = useAppStore((s) => s.healthInfectiousDistributionFilters);
  const layerState = useAppStore((s) => s.layers['health-infectious-distribution']);
  const layerReady = Boolean(layerState);
  const layerVisible = Boolean(layerState?.visible);
  const seenWarnings = useRef<Set<string>>(new Set());
  const queryKey = [
    ...QUERY_KEY,
    filters.year ?? 'latest',
    filters.metric,
    filters.disease ?? 'auto',
  ] as const;

  const query = useQuery({
    queryKey,
    queryFn: fetchHealthInfectiousDistribution,
    enabled: layerReady && layerVisible,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  usePolling([...queryKey], REFRESH_INTERVAL_MS, layerReady && layerVisible);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource('health-infectious-distribution', source);
    setDomainDataSource('health', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `health:infectious-distribution:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Health:infectious-distribution] ${warning}`);
      }
    }

    if (payload.filters) {
      setHealthInfectiousDistributionMeta({
        availableYears: payload.filters.availableYears,
        selectedYear: payload.filters.selectedYear,
        diseaseOptions: payload.filters.diseaseOptions,
        updatedAt: payload.updatedAt ?? null,
      });
    }

    setHealthInfectiousDistributionData(payload.data ?? null);
  }, [
    query.data,
    setDomainDataSource,
    setHealthInfectiousDistributionData,
    setHealthInfectiousDistributionMeta,
    setLayerDataSource,
  ]);
}
