import type { DomainType, LayerType, SelectedObject } from '@/types/domain';

interface LayerIdentity {
  id: string;
  domain: DomainType;
  type: LayerType | string;
}

const ID_PROPERTY_KEYS = ['id', 'objectId', 'callsign', 'mmsi', 'trainNo', 'name', 'title'] as const;

function toIdString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function pickFeatureCoordinates(feature: GeoJSON.Feature): [number, number] {
  const geometry = feature.geometry;
  if (!geometry) return [127.5, 36.5];

  if (geometry.type === 'Point') {
    return [geometry.coordinates[0], geometry.coordinates[1]];
  }

  if (geometry.type === 'LineString' && geometry.coordinates[0]) {
    return [geometry.coordinates[0][0], geometry.coordinates[0][1]];
  }

  if (geometry.type === 'Polygon' && geometry.coordinates[0]?.[0]) {
    return [geometry.coordinates[0][0][0], geometry.coordinates[0][0][1]];
  }

  return [127.5, 36.5];
}

export function deriveFeatureObjectId(feature: GeoJSON.Feature, fallbackLayerId: string): string {
  const fromFeatureId = toIdString(feature.id);
  if (fromFeatureId) return fromFeatureId;

  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  for (const key of ID_PROPERTY_KEYS) {
    const fromProperty = toIdString(properties[key]);
    if (fromProperty) return fromProperty;
  }

  return `${fallbackLayerId}-object`;
}

export function toSelectedObjectFromFeature(
  feature: GeoJSON.Feature,
  layer: LayerIdentity
): SelectedObject {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};

  return {
    id: deriveFeatureObjectId(feature, layer.id),
    domain: layer.domain,
    type: layer.type,
    properties,
    coordinates: pickFeatureCoordinates(feature),
  };
}
