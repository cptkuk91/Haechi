'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore, type HealthInfectiousRiskDiseaseOption, type HealthInfectiousRiskMetric } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';

interface HealthInfectiousRiskSidoFiltersResponse {
  availableYears: number[];
  selectedYear: number | null;
  selectedMetric: HealthInfectiousRiskMetric;
  selectedDisease: string | null;
  diseaseOptions: HealthInfectiousRiskDiseaseOption[];
}

interface HealthInfectiousRiskSidoAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
  filters?: HealthInfectiousRiskSidoFiltersResponse;
}

const QUERY_KEY = ['health', 'infectious-risk-sido'] as const;
const REFRESH_INTERVAL_MS = 6 * 60 * 60_000;

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchHealthInfectiousRiskSido(): Promise<HealthInfectiousRiskSidoAPIResponse> {
  const filters = useAppStore.getState().healthInfectiousRiskFilters;
  const url = new URL('/api/health/infectious-risk-sido', window.location.origin);
  url.searchParams.set('metric', filters.metric);
  if (typeof filters.year === 'number') {
    url.searchParams.set('year', String(filters.year));
  }
  if (filters.disease) {
    url.searchParams.set('disease', filters.disease);
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load health infectious risk layer: ${response.status}`);
  }
  return (await response.json()) as HealthInfectiousRiskSidoAPIResponse;
}

export function useHealthInfectiousRiskSidoLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const setHealthInfectiousRiskMeta = useAppStore((s) => s.setHealthInfectiousRiskMeta);
  const filters = useAppStore((s) => s.healthInfectiousRiskFilters);
  const layerState = useAppStore((s) => s.layers['health-infectious-risk-sido']);
  const layerReady = Boolean(layerState);
  const layerVisible = Boolean(layerState?.visible);
  const seenWarnings = useRef<Set<string>>(new Set());
  const queryKey = [
    ...QUERY_KEY,
    filters.year ?? 'latest',
    filters.metric,
    filters.disease ?? 'all',
  ] as const;

  const query = useQuery({
    queryKey,
    queryFn: fetchHealthInfectiousRiskSido,
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
    setLayerDataSource('health-infectious-risk-sido', source);
    setDomainDataSource('health', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `health:infectious-risk-sido:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Health:infectious-risk-sido] ${warning}`);
      }
    }

    if (payload.filters) {
      setHealthInfectiousRiskMeta({
        availableYears: payload.filters.availableYears,
        selectedYear: payload.filters.selectedYear,
        diseaseOptions: payload.filters.diseaseOptions,
        updatedAt: payload.updatedAt ?? null,
      });
    }

    if (!layerReady || !layerVisible) return;
    if (!isFeatureCollection(payload.data)) return;
    updateLayerData('health-infectious-risk-sido', payload.data);
  }, [layerReady, layerVisible, query.data, setDomainDataSource, setHealthInfectiousRiskMeta, setLayerDataSource, updateLayerData]);
}
