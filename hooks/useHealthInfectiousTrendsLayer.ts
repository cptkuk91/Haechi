'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  useAppStore,
  type HealthInfectiousTrendData,
  type HealthInfectiousTrendDiseaseOption,
  type HealthInfectiousTrendPeriodType,
} from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface HealthInfectiousTrendsFiltersResponse {
  availableYears: number[];
  selectedPeriodType: HealthInfectiousTrendPeriodType;
  selectedStartYear: number;
  selectedEndYear: number;
  selectedDisease: string | null;
  diseaseOptions: HealthInfectiousTrendDiseaseOption[];
}

interface HealthInfectiousTrendsAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: HealthInfectiousTrendData | null;
  warnings?: string[];
  filters?: HealthInfectiousTrendsFiltersResponse;
}

const QUERY_KEY = ['health', 'infectious-trends'] as const;
const REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

async function fetchHealthInfectiousTrends(): Promise<HealthInfectiousTrendsAPIResponse> {
  const filters = useAppStore.getState().healthInfectiousTrendFilters;
  const url = new URL('/api/health/infectious-trends', window.location.origin);
  url.searchParams.set('periodType', filters.periodType);
  url.searchParams.set('startYear', String(filters.startYear));
  url.searchParams.set('endYear', String(filters.endYear));
  if (filters.disease) {
    url.searchParams.set('disease', filters.disease);
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load health infectious trends: ${response.status}`);
  }
  return (await response.json()) as HealthInfectiousTrendsAPIResponse;
}

export function useHealthInfectiousTrendsLayer() {
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const setHealthInfectiousTrendMeta = useAppStore((s) => s.setHealthInfectiousTrendMeta);
  const setHealthInfectiousTrendData = useAppStore((s) => s.setHealthInfectiousTrendData);
  const filters = useAppStore((s) => s.healthInfectiousTrendFilters);
  const layerState = useAppStore((s) => s.layers['health-infectious-trends']);
  const layerReady = Boolean(layerState);
  const layerVisible = Boolean(layerState?.visible);
  const seenWarnings = useRef<Set<string>>(new Set());
  const queryKey = [
    ...QUERY_KEY,
    filters.periodType,
    filters.startYear,
    filters.endYear,
    filters.disease ?? 'all',
  ] as const;

  const query = useQuery({
    queryKey,
    queryFn: fetchHealthInfectiousTrends,
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
    setLayerDataSource('health-infectious-trends', source);
    setDomainDataSource('health', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `health:infectious-trends:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Health:infectious-trends] ${warning}`);
      }
    }

    if (payload.filters) {
      setHealthInfectiousTrendMeta({
        availableYears: payload.filters.availableYears,
        selectedPeriodType: payload.filters.selectedPeriodType,
        selectedStartYear: payload.filters.selectedStartYear,
        selectedEndYear: payload.filters.selectedEndYear,
        diseaseOptions: payload.filters.diseaseOptions,
        updatedAt: payload.updatedAt ?? null,
      });
    }

    setHealthInfectiousTrendData(payload.data ?? null);
  }, [query.data, setDomainDataSource, setHealthInfectiousTrendData, setHealthInfectiousTrendMeta, setLayerDataSource]);
}
