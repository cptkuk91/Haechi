export function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

export function isFeatureCollection(value: unknown): value is GeoJSON.FeatureCollection {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as { type?: unknown; features?: unknown };
  return maybe.type === 'FeatureCollection' && Array.isArray(maybe.features);
}

export function isValidPointFeature(feature: GeoJSON.Feature): boolean {
  if (!feature.geometry || feature.geometry.type !== 'Point') return false;
  const coords = feature.geometry.coordinates;

  return (
    Array.isArray(coords)
    && typeof coords[0] === 'number'
    && typeof coords[1] === 'number'
    && Number.isFinite(coords[0])
    && Number.isFinite(coords[1])
  );
}
