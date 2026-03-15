'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { usePolling } from '@/hooks/usePolling';
import {
  formatWeatherAirStationBbox,
  getWeatherAirStationFeatureLimitForZoom,
} from '@/lib/weather-air-quality-stations';

const LAYER_ID = 'weather-air-quality-stations';
const QUERY_KEY = ['weather', 'air-quality-stations'] as const;
const REFRESH_INTERVAL_MS = 12 * 60 * 60_000;

interface WeatherAirQualityStationsAPIResponse {
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

async function fetchWeatherAirQualityStations(
  limit: number,
  bboxParam: string | null
): Promise<WeatherAirQualityStationsAPIResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (bboxParam) params.set('bbox', bboxParam);

  const response = await fetch(`/api/weather/air-quality-stations?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load weather air quality stations: ${response.status}`);
  }
  return (await response.json()) as WeatherAirQualityStationsAPIResponse;
}

export function useWeatherAirQualityStationsLayer() {
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
  const limit = getWeatherAirStationFeatureLimitForZoom(zoom);

  const query = useQuery({
    queryKey: [...QUERY_KEY, bboxParam ?? 'no-bbox', limit],
    queryFn: () => fetchWeatherAirQualityStations(limit, bboxParam),
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
        const key = `weather:air-quality-stations:${warning}`;
        if (seenWarnings.current.has(key)) continue;
        seenWarnings.current.add(key);
        console.warn(`[Weather:air-quality-stations] ${warning}`);
      }
    }

    if (!layerReady || !layerVisible) return;
    if (!isFeatureCollection(payload.data)) return;
    updateLayerData(LAYER_ID, payload.data);
  }, [layerReady, layerVisible, query.data, setDomainDataSource, setLayerDataSource, updateLayerData]);
}
