import type {
  AlertPayload,
  DomainPayload,
  LayerPayload,
  Team2DomainRoute,
} from '@/app/api/_shared/domain-payload';
import type { AlertSeverity, DomainType, LayerType } from '@/types/domain';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function inferCoordinates(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = toNumber(value[0]);
  const lat = toNumber(value[1]);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}

function toAlertSeverity(value: unknown): AlertSeverity {
  if (value === 'info' || value === 'warning' || value === 'critical') return value;
  return 'info';
}

function inferDomain(value: unknown, fallback: DomainType): DomainType {
  const known: DomainType[] = [
    'aviation',
    'cctv',
    'maritime',
    'transit',
    'defense',
    'cyber',
    'highway',
    'disaster',
    'weather',
    'crime',
    'health',
    'infra',
    'vulnerable',
  ];

  if (typeof value === 'string' && known.includes(value as DomainType)) {
    return value as DomainType;
  }
  return fallback;
}

function inferLayerType(value: unknown, fallback: LayerType): LayerType {
  const known: LayerType[] = ['marker', 'polygon', 'line', 'heatmap', 'particle', 'arc', 'icon', 'column'];
  if (typeof value === 'string' && known.includes(value as LayerType)) {
    return value as LayerType;
  }
  return fallback;
}

function featureFromRecord(record: Record<string, unknown>, index: number): GeoJSON.Feature | null {
  if (record.type === 'Feature' && isObject(record.geometry)) {
    return record as unknown as GeoJSON.Feature;
  }

  const directGeometry = record.geometry;
  if (isObject(directGeometry) && typeof directGeometry.type === 'string' && Array.isArray(directGeometry.coordinates)) {
    return {
      type: 'Feature',
      geometry: directGeometry as unknown as GeoJSON.Geometry,
      properties: isObject(record.properties) ? record.properties : {},
    };
  }

  const pointCoords =
    inferCoordinates(record.coordinates) ?? inferCoordinates([record.lng ?? record.lon, record.lat]);

  if (pointCoords) {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: pointCoords,
      },
      properties: {
        id: record.id ?? `feature-${index}`,
        ...(isObject(record.properties) ? record.properties : {}),
      },
    };
  }

  return null;
}

function normalizeFeatureCollection(value: unknown): GeoJSON.FeatureCollection {
  if (isObject(value) && value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value as unknown as GeoJSON.FeatureCollection;
  }

  const source = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.features)
      ? value.features
      : isObject(value) && Array.isArray(value.items)
        ? value.items
        : [];

  const features = source
    .map((item, index) => (isObject(item) ? featureFromRecord(item, index) : null))
    .filter((item): item is GeoJSON.Feature => item !== null);

  return { type: 'FeatureCollection', features };
}

function normalizeLayer(
  layerRaw: unknown,
  index: number,
  defaultDomain: DomainType
): LayerPayload | null {
  if (!isObject(layerRaw)) return null;

  const id = typeof layerRaw.id === 'string' ? layerRaw.id : `upstream-layer-${index}`;
  const name = typeof layerRaw.name === 'string' ? layerRaw.name : id;
  const domain = inferDomain(layerRaw.domain, defaultDomain);
  const type = inferLayerType(layerRaw.type, 'marker');
  const visible = layerRaw.visible !== false;

  const style = isObject(layerRaw.style)
    ? {
        color: layerRaw.style.color as LayerPayload['style']['color'],
        radius: toNumber(layerRaw.style.radius) ?? undefined,
        lineWidth: toNumber(layerRaw.style.lineWidth) ?? undefined,
        opacity: toNumber(layerRaw.style.opacity) ?? undefined,
        elevation: toNumber(layerRaw.style.elevation) ?? undefined,
      }
    : {};

  const dataCandidate =
    layerRaw.data ?? (Array.isArray(layerRaw.features) ? layerRaw.features : layerRaw.items ?? []);

  const data = normalizeFeatureCollection(dataCandidate);

  return {
    id,
    domain,
    name,
    type,
    visible,
    style,
    data,
  };
}

function normalizeAlert(alertRaw: unknown, index: number, defaultDomain: DomainType): AlertPayload | null {
  if (!isObject(alertRaw)) return null;

  return {
    id: typeof alertRaw.id === 'string' ? alertRaw.id : `alert-${index}`,
    severity: toAlertSeverity(alertRaw.severity),
    domain: inferDomain(alertRaw.domain, defaultDomain),
    title: typeof alertRaw.title === 'string' ? alertRaw.title : 'External Alert',
    message: typeof alertRaw.message === 'string' ? alertRaw.message : 'Alert received from upstream source.',
    coordinates: inferCoordinates(alertRaw.coordinates) ?? undefined,
  };
}

function normalizeMetrics(value: unknown): DomainPayload['metrics'] {
  if (!Array.isArray(value)) return [];

  const metrics: DomainPayload['metrics'] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const label = typeof item.label === 'string' ? item.label : null;
    const metricValue =
      typeof item.value === 'string' || typeof item.value === 'number' ? String(item.value) : null;
    if (!label || !metricValue) continue;

    metrics.push({
      label,
      value: metricValue,
      severity: toAlertSeverity(item.severity),
    });
  }

  return metrics;
}

function routeToDomain(route: Team2DomainRoute): DomainType {
  switch (route) {
    case 'traffic':
      return 'highway';
    case 'weather':
      return 'weather';
    case 'disaster':
      return 'disaster';
    case 'infra':
      return 'infra';
    case 'crime':
      return 'crime';
    case 'health':
      return 'health';
    case 'vulnerable':
      return 'vulnerable';
  }
}

export function normalizeUpstreamPayload(
  route: Team2DomainRoute,
  raw: unknown
): DomainPayload | null {
  if (!isObject(raw)) return null;

  const domainFallback = routeToDomain(route);
  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];

  const layers = rawLayers
    .map((layer, index) => normalizeLayer(layer, index, domainFallback))
    .filter((layer): layer is LayerPayload => layer !== null);

  if (layers.length === 0) {
    return null;
  }

  const alertsRaw = Array.isArray(raw.alerts) ? raw.alerts : [];
  const alerts = alertsRaw
    .map((alert, index) => normalizeAlert(alert, index, domainFallback))
    .filter((alert): alert is AlertPayload => alert !== null);

  return {
    domain: route,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    layers,
    alerts,
    metrics: normalizeMetrics(raw.metrics),
  };
}
