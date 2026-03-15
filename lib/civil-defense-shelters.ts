import type { MapBounds } from '@/stores/app-store';

export function formatCivilDefenseShelterBbox(bounds: MapBounds | null): string | null {
  if (!bounds) return null;
  return [
    bounds.west.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.north.toFixed(5),
  ].join(',');
}

export function getCivilDefenseShelterFeatureLimitForZoom(zoom: number): number {
  if (zoom < 5.5) return 100;
  if (zoom < 7) return 220;
  if (zoom < 8.5) return 400;
  if (zoom < 10) return 700;
  return 1200;
}

export function getCivilDefenseShelterMaxPagesForZoom(zoom: number): number {
  if (zoom < 5.5) return 12;
  if (zoom < 7) return 20;
  if (zoom < 8.5) return 28;
  if (zoom < 10) return 40;
  return 56;
}
