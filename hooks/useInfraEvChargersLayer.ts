'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';
import {
  formatInfraEvChargerBbox,
  getInfraEvChargerFeatureLimitForZoom,
} from '@/lib/infra-ev-chargers';

const LAYER_ID = 'infra-ev-chargers';
const QUERY_KEY = ['infra', 'ev-chargers'] as const;
const REFRESH_INTERVAL_MS = 20 * 60 * 1000;

interface InfraEvChargersAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  totalCount?: number;
  matchedCount?: number;
  data?: GeoJSON.FeatureCollection;
  warnings?: string[];
  meta?: {
    featureLimit?: number;
    featureCount?: number;
    bboxApplied?: boolean;
  };
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchInfraEvChargers(
  limit: number,
  bboxParam: string | null
): Promise<InfraEvChargersAPIResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/infra/ev-chargers?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load infra EV charger layer: ${response.status}`);
  }
  return (await response.json()) as InfraEvChargersAPIResponse;
}

export function useInfraEvChargersLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const layerState = useAppStore((s) => s.layers[LAYER_ID]);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const zoom = useAppStore((s) => s.camera.zoom);
  const layerReady = Boolean(layerState);
  const layerVisible = Boolean(layerState?.visible);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = formatInfraEvChargerBbox(mapBounds);
  const limit = getInfraEvChargerFeatureLimitForZoom(zoom);
  const queryEnabled = layerReady && layerVisible && Boolean(bboxParam);

  const query = useQuery({
    queryKey: [...QUERY_KEY, bboxParam ?? 'no-bbox', limit],
    queryFn: () => fetchInfraEvChargers(limit, bboxParam),
    enabled: queryEnabled,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  usePolling([...QUERY_KEY, bboxParam ?? 'no-bbox', limit], REFRESH_INTERVAL_MS, queryEnabled);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(LAYER_ID, source);
    setDomainDataSource('infra', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `infra:ev-chargers:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Infra:ev-chargers] ${warning}`);
      }
    }

    if (!layerReady || !layerVisible) return;
    if (!isFeatureCollection(payload.data)) return;
    updateLayerData(LAYER_ID, payload.data);
  }, [layerReady, layerVisible, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
