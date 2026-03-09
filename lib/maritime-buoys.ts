export const DEFAULT_MARITIME_BUOY_MAP_FEATURE_LIMIT = 1200;
export const MIN_MARITIME_BUOY_MAP_FEATURE_LIMIT = 100;
export const MAX_MARITIME_BUOY_MAP_FEATURE_LIMIT = 4000;

export interface MaritimeBuoyBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function clampMaritimeBuoyFeatureLimit(value: number): number {
  return Math.min(
    MAX_MARITIME_BUOY_MAP_FEATURE_LIMIT,
    Math.max(MIN_MARITIME_BUOY_MAP_FEATURE_LIMIT, Math.floor(value))
  );
}

export function getMaritimeBuoyFeatureLimitForZoom(zoom: number): number {
  if (zoom < 7) return 350;
  if (zoom < 10) return 900;
  if (zoom < 13) return 1800;
  return 3000;
}

export function formatMaritimeBuoyBbox(bounds: MaritimeBuoyBbox | null): string | null {
  if (!bounds) return null;
  return [
    bounds.west.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.north.toFixed(5),
  ].join(',');
}

export function parseMaritimeBuoyBbox(raw: string | null): MaritimeBuoyBbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function includesMaritimeBuoyCoordinate(
  bbox: MaritimeBuoyBbox | null,
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
