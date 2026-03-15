'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';
import {
  formatCivilDefenseShelterBbox,
  getCivilDefenseShelterFeatureLimitForZoom,
  getCivilDefenseShelterMaxPagesForZoom,
} from '@/lib/civil-defense-shelters';

const LAYER_ID = 'disaster-civil-defense-shelters';
const REFRESH_INTERVAL_MS = 12 * 60 * 60_000;

interface CivilDefenseShelterAPIResponse {
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

async function fetchCivilDefenseShelters(
  maxCount: number,
  bboxParam: string | null,
  maxPages: number
): Promise<CivilDefenseShelterAPIResponse> {
  const params = new URLSearchParams({ max: String(maxCount), maxPages: String(maxPages) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/disaster/civil-defense-shelters?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load civil defense shelters: ${response.status}`);
  }
  return (await response.json()) as CivilDefenseShelterAPIResponse;
}

function limitFeatureCount(data: GeoJSON.FeatureCollection, maxCount: number): GeoJSON.FeatureCollection {
  if (data.features.length <= maxCount) return data;
  return {
    ...data,
    features: data.features.slice(0, maxCount),
  };
}

export function useCivilDefenseSheltersLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const zoom = useAppStore((s) => s.camera.zoom);
  const visible = useAppStore((s) => s.layers[LAYER_ID]?.visible ?? false);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = formatCivilDefenseShelterBbox(mapBounds);
  const limit = getCivilDefenseShelterFeatureLimitForZoom(zoom);
  const maxPages = getCivilDefenseShelterMaxPagesForZoom(zoom);

  const query = useQuery({
    queryKey: ['disaster', 'civil-defense-shelters', bboxParam ?? 'no-bbox', limit, maxPages],
    queryFn: () => fetchCivilDefenseShelters(limit, bboxParam, maxPages),
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    enabled: visible,
  });

  usePolling(
    ['disaster', 'civil-defense-shelters', bboxParam ?? 'no-bbox', limit, maxPages],
    REFRESH_INTERVAL_MS,
    visible
  );

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(LAYER_ID, source);
    setDomainDataSource('disaster', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `disaster:civil-defense-shelters:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Disaster:civil-defense-shelters] ${warning}`);
      }
    }

    if (source !== 'upstream') return;
    if (!isFeatureCollection(payload.data)) return;

    updateLayerData(LAYER_ID, limitFeatureCount(payload.data, limit));
  }, [limit, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
