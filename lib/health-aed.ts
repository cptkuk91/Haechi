export const DEFAULT_HEALTH_AED_MAP_FEATURE_LIMIT = 2000;
export const MIN_HEALTH_AED_MAP_FEATURE_LIMIT = 100;
export const MAX_HEALTH_AED_MAP_FEATURE_LIMIT = 5000;

export interface HealthAedBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function clampHealthAedFeatureLimit(value: number): number {
  return Math.min(
    MAX_HEALTH_AED_MAP_FEATURE_LIMIT,
    Math.max(MIN_HEALTH_AED_MAP_FEATURE_LIMIT, Math.floor(value))
  );
}

export function getHealthAedFeatureLimitForZoom(zoom: number): number {
  if (zoom < 8) return 300;
  if (zoom < 11) return 800;
  if (zoom < 14) return 2000;
  return 4000;
}

export function formatHealthAedBbox(bounds: HealthAedBbox | null): string | null {
  if (!bounds) return null;
  return [
    bounds.west.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.north.toFixed(5),
  ].join(',');
}

export function parseHealthAedBbox(raw: string | null): HealthAedBbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function includesHealthAedCoordinate(
  bbox: HealthAedBbox | null,
  coordinates: [number, number]
): boolean {
  if (!bbox) return true;
  const [lng, lat] = coordinates;
  return (
    lng >= bbox.west
    && lng <= bbox.east
    && lat >= bbox.south
    && lat <= bbox.north
  );
}
