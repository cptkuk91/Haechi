// 성능 최적화 Deck.gl 레이어 빌더
// LOD 기반 스타일 스케일링 + 뷰포트 필터링 통합

import { GeoJsonLayer, PathLayer, ArcLayer, ScatterplotLayer, ColumnLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { LayerConfig } from '@/types/domain';
import { getLODLevel, getLODStyle, filterByViewport, type ViewportBounds, type LODLevel } from './viewport-utils';

// 색상 파싱 (hex → RGBA)
function parseColor(color: string | [number, number, number, number?] | undefined): [number, number, number, number] | undefined {
  if (!color) return undefined;
  if (Array.isArray(color)) {
    const [r, g, b, a] = color;
    return [r, g, b, a ?? 255];
  }
  const hex = color.replace('#', '');
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255,
    ];
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getDynamicLineColor(
  feature: GeoJSON.Feature,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const explicitColor = parseColor(properties.color as string | [number, number, number, number?] | undefined);
  const pulse = clamp(toFiniteNumber(properties.pulse) ?? 0.75, 0.2, 1.15);

  if (explicitColor) {
    return [
      explicitColor[0],
      explicitColor[1],
      explicitColor[2],
      clamp(Math.round(explicitColor[3] * pulse), 45, 255),
    ];
  }

  const congestion = toFiniteNumber(properties.congestion);
  if (congestion !== null) {
    const alpha = clamp(Math.round((175 + congestion * 70) * pulse), 50, 255);
    if (congestion >= 0.82) return [255, 51, 68, alpha];
    if (congestion >= 0.58) return [255, 184, 0, alpha];
    return [16, 185, 129, alpha];
  }

  return [
    fallback[0],
    fallback[1],
    fallback[2],
    clamp(Math.round(fallback[3] * pulse), 40, 255),
  ];
}

// Feature → Point 좌표 추출
function featureToPoint(feature: GeoJSON.Feature): [number, number] {
  const geometry = feature.geometry;
  if (!geometry) return [127.5, 36.5];
  if (geometry.type === 'Point') return [geometry.coordinates[0], geometry.coordinates[1]];
  if (geometry.type === 'LineString' && geometry.coordinates[0]) return [geometry.coordinates[0][0], geometry.coordinates[0][1]];
  if (geometry.type === 'Polygon' && geometry.coordinates[0]?.[0]) return [geometry.coordinates[0][0][0], geometry.coordinates[0][0][1]];
  return [127.5, 36.5];
}

// 레이어 데이터 캐시 — 같은 데이터가 반복될 때 재필터링 방지
const filterCache = new WeakMap<GeoJSON.Feature[], { bounds: string; lod: LODLevel; result: GeoJSON.Feature[] }>();

function getCacheKey(bounds: ViewportBounds): string {
  return `${bounds.west.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.north.toFixed(3)}`;
}

function getFilteredFeatures(
  features: GeoJSON.Feature[],
  bounds: ViewportBounds,
  lod: LODLevel
): GeoJSON.Feature[] {
  const key = getCacheKey(bounds);
  const cached = filterCache.get(features);

  if (cached && cached.bounds === key && cached.lod === lod) {
    return cached.result;
  }

  const result = filterByViewport(features, bounds, lod);
  filterCache.set(features, { bounds: key, lod, result });
  return result;
}

export interface BuildContext {
  zoom: number;
  bounds: ViewportBounds;
}

// LOD 기반 Deck.gl 레이어 생성
export function buildDeckLayer(config: LayerConfig, ctx: BuildContext) {
  if (!config.data) return null;

  const lod = getLODLevel(ctx.zoom);
  const lodStyle = getLODStyle(lod);

  // 뷰포트 필터링 적용
  const features = getFilteredFeatures(config.data.features, ctx.bounds, lod);
  if (features.length === 0) return null;

  const baseProps = {
    id: config.id,
    data: features,
    pickable: true,
    visible: config.visible,
    updateTriggers: {
      // 데이터 참조가 바뀔 때만 업데이트 트리거
      getPosition: [config.data],
      getRadius: [lod],
      getWidth: [lod],
    },
    onClick: config.onClick
      ? (info: { object?: GeoJSON.Feature }) => {
          if (info.object) config.onClick?.(info.object);
        }
      : undefined,
    onHover: config.onHover
      ? (info: { object?: GeoJSON.Feature }) => {
          if (info.object) config.onHover?.(info.object);
        }
      : undefined,
  };

  switch (config.type) {
    case 'marker':
    case 'icon':
      return new ScatterplotLayer({
        ...baseProps,
        getPosition: (d: GeoJSON.Feature) => featureToPoint(d),
        getRadius: (config.style.radius || 500) * lodStyle.radiusScale,
        getFillColor: parseColor(config.style.color) || [0, 240, 255, 200],
        radiusMinPixels: lod === 'overview' ? 3 : 4,
        radiusMaxPixels: lod === 'street' ? 30 : 20,
        stroked: lod !== 'overview', // overview에서 stroke 생략 (성능)
        getLineColor: [255, 255, 255, 80],
        lineWidthMinPixels: 1,
        opacity: lodStyle.opacity,
      });

    case 'polygon':
      return new GeoJsonLayer({
        ...baseProps,
        data: { type: 'FeatureCollection' as const, features },
        getFillColor: parseColor(config.style.color) || [255, 51, 68, 60],
        getLineColor: parseColor(config.style.color) || [255, 51, 68, 180],
        lineWidthMinPixels: lod === 'overview' ? 0.5 : 1,
        extruded: lod !== 'overview' && !!config.style.elevation,
        getElevation: config.style.elevation || 0,
        opacity: (config.style.opacity ?? 0.6) * lodStyle.opacity,
      });

    case 'line':
      {
        const defaultLineColor = parseColor(config.style.color) || [0, 240, 255, 180];

      return new PathLayer({
        ...baseProps,
        // Deck.gl PathLayer 타입은 데이터 제네릭 추론이 엄격해서 accessor를 any로 캐스팅한다.
        getPath: ((d: GeoJSON.Feature) => (d.geometry as GeoJSON.LineString).coordinates) as any,
        getColor: (d: GeoJSON.Feature) => getDynamicLineColor(d, defaultLineColor),
        getWidth: (d: GeoJSON.Feature) => {
          const props = (d.properties as Record<string, unknown> | null) ?? {};
          const baseWidth = toFiniteNumber(props.lineWidth) ?? config.style.lineWidth ?? 3;
          const pulse = clamp(toFiniteNumber(props.pulse) ?? 0.8, 0.45, 1.2);
          return baseWidth * lodStyle.lineWidthScale * (0.85 + pulse * 0.32);
        },
        widthMinPixels: lod === 'overview' ? 1 : 2,
        capRounded: lod !== 'overview',
        jointRounded: lod !== 'overview',
      });
    }

    case 'heatmap':
      return new HeatmapLayer({
        id: config.id,
        data: features,
        visible: config.visible,
        getPosition: (d: GeoJSON.Feature) => featureToPoint(d),
        getWeight: (d: GeoJSON.Feature) => (d.properties as Record<string, number>)?.weight || 1,
        radiusPixels: (config.style.radius || 30) * lodStyle.radiusScale,
        intensity: 1,
        threshold: 0.1,
        colorRange: [
          [0, 240, 255, 0] as [number, number, number, number],
          [0, 240, 255, 80] as [number, number, number, number],
          [255, 184, 0, 150] as [number, number, number, number],
          [255, 51, 68, 200] as [number, number, number, number],
          [255, 51, 68, 255] as [number, number, number, number],
        ],
      });

    case 'arc':
      return new ArcLayer({
        ...baseProps,
        getSourcePosition: (d: GeoJSON.Feature) => (d.properties as Record<string, unknown>)?.source as [number, number] || featureToPoint(d),
        getTargetPosition: (d: GeoJSON.Feature) => (d.properties as Record<string, unknown>)?.target as [number, number] || [127.5, 36.5],
        getSourceColor: [255, 51, 68, 200],
        getTargetColor: [0, 240, 255, 200],
        getWidth: (config.style.lineWidth || 2) * lodStyle.lineWidthScale,
        greatCircle: true,
      });

    case 'column':
      return new ColumnLayer({
        ...baseProps,
        diskResolution: lod === 'overview' ? 8 : lod === 'city' ? 12 : 16,
        radius: (config.style.radius ?? 900) * lodStyle.radiusScale,
        extruded: true,
        getPosition: (d: GeoJSON.Feature) => featureToPoint(d),
        getElevation: (d: GeoJSON.Feature) =>
          Number((d.properties as Record<string, unknown>)?.rainMm ?? (d.properties as Record<string, unknown>)?.value ?? (d.properties as Record<string, unknown>)?.intensity ?? config.style.elevation ?? 600),
        elevationScale: 12,
        getFillColor: parseColor(config.style.color) || [59, 130, 246, 180],
        getLineColor: [255, 255, 255, 80],
        lineWidthMinPixels: 1,
      });

    case 'particle':
      return new ScatterplotLayer({
        ...baseProps,
        getPosition: (d: GeoJSON.Feature) => featureToPoint(d),
        getRadius: (d: GeoJSON.Feature) => {
          const props = d.properties as Record<string, unknown>;
          const speed = Number(props?.speedKph ?? props?.windKph ?? props?.speed ?? 0);
          return Math.max(config.style.radius ?? 300, speed * 22) * lodStyle.radiusScale;
        },
        radiusMinPixels: 2,
        radiusMaxPixels: 26,
        stroked: false,
        opacity: (config.style.opacity ?? 0.68) * lodStyle.opacity,
        getFillColor: parseColor(config.style.color) || [34, 211, 238, 190],
      });

    default:
      return new GeoJsonLayer({
        ...baseProps,
        data: { type: 'FeatureCollection' as const, features },
        getFillColor: parseColor(config.style.color) || [0, 240, 255, 100],
        getLineColor: [0, 240, 255, 180],
        lineWidthMinPixels: 1,
      });
  }
}
