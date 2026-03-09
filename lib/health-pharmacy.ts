export const DEFAULT_HEALTH_PHARMACY_MAP_FEATURE_LIMIT = 1500;
export const MIN_HEALTH_PHARMACY_MAP_FEATURE_LIMIT = 100;
export const MAX_HEALTH_PHARMACY_MAP_FEATURE_LIMIT = 5000;

export interface HealthPharmacyBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function clampHealthPharmacyFeatureLimit(value: number): number {
  return Math.min(
    MAX_HEALTH_PHARMACY_MAP_FEATURE_LIMIT,
    Math.max(MIN_HEALTH_PHARMACY_MAP_FEATURE_LIMIT, Math.floor(value))
  );
}

export function getHealthPharmacyFeatureLimitForZoom(zoom: number): number {
  if (zoom < 8) return 250;
  if (zoom < 11) return 700;
  if (zoom < 14) return 1500;
  return 3000;
}

export function formatHealthPharmacyBbox(bounds: HealthPharmacyBbox | null): string | null {
  if (!bounds) return null;
  return [
    bounds.west.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.north.toFixed(5),
  ].join(',');
}

export function parseHealthPharmacyBbox(raw: string | null): HealthPharmacyBbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function includesHealthPharmacyCoordinate(
  bbox: HealthPharmacyBbox | null,
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
