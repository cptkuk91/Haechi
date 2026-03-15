'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';
import { getWeatherAirHeatmapFeatureLimitForZoom } from '@/lib/weather-air-quality-heatmap';
import { formatWeatherAirStationBbox } from '@/lib/weather-air-quality-stations';

const LAYER_ID = 'weather-air-quality-heatmap';
const QUERY_KEY = ['weather', 'air-quality-heatmap'] as const;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

interface WeatherAirQualityHeatmapAPIResponse {
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
    weightFormula?: string;
  };
}

function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

async function fetchWeatherAirQualityHeatmap(
  limit: number,
  bboxParam: string | null
): Promise<WeatherAirQualityHeatmapAPIResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/weather/air-quality-heatmap?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load weather air quality heatmap: ${response.status}`);
  }
  return (await response.json()) as WeatherAirQualityHeatmapAPIResponse;
}

export function useWeatherAirQualityHeatmapLayer() {
  const updateLayerData = useAppStore((s) => s.updateLayerData);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const layerState = useAppStore((s) => s.layers[LAYER_ID]);
  const mapBounds = useAppStore((s) => s.mapBounds);
  const zoom = useAppStore((s) => s.camera.zoom);
  const layerReady = Boolean(layerState);
  const layerVisible = Boolean(layerState?.visible);
  const seenWarnings = useRef<Set<string>>(new Set());
  const bboxParam = formatWeatherAirStationBbox(mapBounds);
  const limit = getWeatherAirHeatmapFeatureLimitForZoom(zoom);

  const query = useQuery({
    queryKey: [...QUERY_KEY, bboxParam ?? 'no-bbox', limit],
    queryFn: () => fetchWeatherAirQualityHeatmap(limit, bboxParam),
    enabled: layerReady && layerVisible,
    staleTime: REFRESH_INTERVAL_MS,
    retry: 2,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  usePolling([...QUERY_KEY, bboxParam ?? 'no-bbox', limit], REFRESH_INTERVAL_MS, layerReady && layerVisible);

  useEffect(() => {
    const payload = query.data;
    if (!payload) return;

    const source = payload.source ?? 'mock';
    setLayerDataSource(LAYER_ID, source);
    setDomainDataSource('weather', source);

    if (payload.warnings?.length) {
      for (const warning of payload.warnings) {
        const key = `weather:air-quality-heatmap:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Weather:air-quality-heatmap] ${warning}`);
      }
    }

    if (!layerReady || !layerVisible) return;
    if (!isFeatureCollection(payload.data)) return;
    updateLayerData(LAYER_ID, payload.data);
  }, [layerReady, layerVisible, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
