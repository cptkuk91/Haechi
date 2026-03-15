import type { MapBounds } from '@/stores/app-store';

export const DEFAULT_WEATHER_AIR_STATION_FEATURE_LIMIT = 350;
export const MIN_WEATHER_AIR_STATION_FEATURE_LIMIT = 50;
export const MAX_WEATHER_AIR_STATION_FEATURE_LIMIT = 800;

export interface WeatherAirStationBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function clampWeatherAirStationFeatureLimit(value: number): number {
  return Math.min(
    MAX_WEATHER_AIR_STATION_FEATURE_LIMIT,
    Math.max(MIN_WEATHER_AIR_STATION_FEATURE_LIMIT, Math.floor(value))
  );
}

export function getWeatherAirStationFeatureLimitForZoom(zoom: number): number {
  if (zoom < 6) return 120;
  if (zoom < 7.5) return 220;
  if (zoom < 9) return 350;
  if (zoom < 10.5) return 500;
  return 800;
}

export function formatWeatherAirStationBbox(bounds: MapBounds | null): string | null {
  if (!bounds) return null;
  return [
    bounds.west.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.north.toFixed(5),
  ].join(',');
}

export function parseWeatherAirStationBbox(raw: string | null): WeatherAirStationBbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function includesWeatherAirStationCoordinate(
  bbox: WeatherAirStationBbox | null,
  coordinates: GeoJSON.Position
): boolean {
  if (!bbox) return true;
  const [lng, lat] = coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  return (
    lng >= bbox.west
    && lng <= bbox.east
    && lat >= bbox.south
    && lat <= bbox.north
  );
}
