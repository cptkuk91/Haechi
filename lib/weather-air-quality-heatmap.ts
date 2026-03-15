export const DEFAULT_WEATHER_AIR_HEATMAP_FEATURE_LIMIT = 420;
export const MIN_WEATHER_AIR_HEATMAP_FEATURE_LIMIT = 80;
export const MAX_WEATHER_AIR_HEATMAP_FEATURE_LIMIT = 800;

export function clampWeatherAirHeatmapFeatureLimit(value: number): number {
  return Math.min(
    MAX_WEATHER_AIR_HEATMAP_FEATURE_LIMIT,
    Math.max(MIN_WEATHER_AIR_HEATMAP_FEATURE_LIMIT, Math.floor(value))
  );
}

export function getWeatherAirHeatmapFeatureLimitForZoom(zoom: number): number {
  if (zoom < 6) return 180;
  if (zoom < 7.5) return 320;
  if (zoom < 9) return 420;
  if (zoom < 10.5) return 560;
  return 800;
}
