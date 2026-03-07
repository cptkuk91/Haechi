// 성능 최적화 Deck.gl 레이어 빌더
// LOD 기반 스타일 스케일링 + 뷰포트 필터링 통합

import { GeoJsonLayer, PathLayer, ScatterplotLayer } from '@deck.gl/layers';
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

function toPastelColor(
  color: [number, number, number, number],
  options?: { mix?: number; alphaScale?: number; minAlpha?: number; maxAlpha?: number }
): [number, number, number, number] {
  const mix = options?.mix ?? 0.4;
  const alphaScale = options?.alphaScale ?? 0.76;
  const minAlpha = options?.minAlpha ?? 40;
  const maxAlpha = options?.maxAlpha ?? 220;
  const [r, g, b, a] = color;
  return [
    Math.round(r + (255 - r) * mix),
    Math.round(g + (255 - g) * mix),
    Math.round(b + (255 - b) * mix),
    clamp(Math.round(a * alphaScale), minAlpha, maxAlpha),
  ];
}

function getDynamicLineColor(
  feature: GeoJSON.Feature,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const explicitColor = parseColor(properties.color as string | [number, number, number, number?] | undefined);
  const pulse = clamp(toFiniteNumber(properties.pulse) ?? 0.75, 0.2, 1.15);

  if (explicitColor) {
    const pastel = toPastelColor(explicitColor);
    return [pastel[0], pastel[1], pastel[2], clamp(Math.round(pastel[3] * pulse), 45, 225)];
  }

  const congestion = toFiniteNumber(properties.congestion);
  if (congestion !== null) {
    const alpha = clamp(Math.round((140 + congestion * 55) * pulse), 45, 210);
    if (congestion >= 0.82) return [247, 182, 192, alpha];
    if (congestion >= 0.58) return [251, 214, 167, alpha];
    return [179, 227, 207, alpha];
  }

  const pastelFallback = toPastelColor(fallback);
  return [
    pastelFallback[0],
    pastelFallback[1],
    pastelFallback[2],
    clamp(Math.round(pastelFallback[3] * pulse), 40, 220),
  ];
}

function getDynamicPolygonFillColor(
  feature: GeoJSON.Feature,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const explicitColor =
    parseColor(properties.fillColor as string | [number, number, number, number?] | undefined)
    ?? parseColor(properties.color as string | [number, number, number, number?] | undefined);

  if (!explicitColor) {
    return toPastelColor(fallback, { mix: 0.44, alphaScale: 0.46 });
  }

  return explicitColor;
}

function getDynamicPolygonLineColor(
  feature: GeoJSON.Feature,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  const properties = (feature.properties as Record<string, unknown> | null) ?? {};
  const explicitColor =
    parseColor(properties.lineColor as string | [number, number, number, number?] | undefined)
    ?? parseColor(properties.strokeColor as string | [number, number, number, number?] | undefined)
    ?? parseColor(properties.color as string | [number, number, number, number?] | undefined);

  if (!explicitColor) {
    return toPastelColor(fallback, { mix: 0.3, alphaScale: 0.9 });
  }

  return explicitColor;
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
    case 'icon': {
      const markerColor = toPastelColor(parseColor(config.style.color) ?? [92, 181, 255, 210], {
        mix: 0.34,
        alphaScale: 0.82,
      });
      return new ScatterplotLayer({
        ...baseProps,
        getPosition: (d: GeoJSON.Feature) => featureToPoint(d),
        getRadius: (config.style.radius || 500) * lodStyle.radiusScale,
        getFillColor: markerColor,
        radiusMinPixels: lod === 'overview' ? 3 : 4,
        radiusMaxPixels: lod === 'street' ? 24 : 18,
        stroked: true,
        getLineColor: [242, 247, 255, 150],
        lineWidthMinPixels: 1,
        opacity: lodStyle.opacity,
      });
    }

    case 'polygon': {
      const polygonBase = parseColor(config.style.color) ?? [255, 119, 140, 140];
      return new GeoJsonLayer({
        ...baseProps,
        data: { type: 'FeatureCollection' as const, features },
        getFillColor: (feature: GeoJSON.Feature) => getDynamicPolygonFillColor(feature, polygonBase),
        getLineColor: (feature: GeoJSON.Feature) => getDynamicPolygonLineColor(feature, polygonBase),
        lineWidthMinPixels: lod === 'overview' ? 0.5 : 1,
        extruded: false,
        opacity: (config.style.opacity ?? 0.6) * lodStyle.opacity,
      });
    }

    case 'line': {
      const defaultLineColor = parseColor(config.style.color) ?? [92, 181, 255, 190];

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
        capRounded: true,
        jointRounded: true,
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
          [199, 233, 255, 0] as [number, number, number, number],
          [179, 222, 255, 85] as [number, number, number, number],
          [191, 234, 224, 130] as [number, number, number, number],
          [248, 216, 182, 190] as [number, number, number, number],
          [246, 182, 194, 235] as [number, number, number, number],
        ],
      });

    case 'arc': {
      const arcColor = toPastelColor(parseColor(config.style.color) ?? [141, 156, 255, 200], {
        mix: 0.36,
        alphaScale: 0.84,
      });
      return new PathLayer({
        ...baseProps,
        getPath: ((d: GeoJSON.Feature) => {
          const props = (d.properties as Record<string, unknown> | null) ?? {};
          const source = (props.source as [number, number] | undefined) ?? featureToPoint(d);
          const target = (props.target as [number, number] | undefined) ?? [127.5, 36.5];
          return [source, target];
        }) as any,
        getColor: arcColor,
        getWidth: (config.style.lineWidth || 2) * lodStyle.lineWidthScale,
        widthMinPixels: lod === 'overview' ? 1 : 2,
        capRounded: true,
        jointRounded: true,
      });
    }

    case 'column': {
      const columnFill = toPastelColor(parseColor(config.style.color) ?? [125, 189, 255, 190], {
        mix: 0.28,
        alphaScale: 0.78,
      });
      return new ScatterplotLayer({
        ...baseProps,
        getPosition: (d: GeoJSON.Feature) => featureToPoint(d),
        getRadius: (d: GeoJSON.Feature) => {
          const props = (d.properties as Record<string, unknown> | null) ?? {};
          const raw =
            toFiniteNumber(props.rainMm) ??
            toFiniteNumber(props.value) ??
            toFiniteNumber(props.intensity) ??
            toFiniteNumber(config.style.elevation) ??
            600;
          const valueScale = clamp(raw / 520, 0.9, 3.1);
          return (config.style.radius ?? 380) * lodStyle.radiusScale * valueScale;
        },
        radiusMinPixels: lod === 'overview' ? 3 : 4,
        radiusMaxPixels: lod === 'street' ? 28 : 20,
        getFillColor: columnFill,
        stroked: true,
        getLineColor: [236, 244, 255, 125],
        lineWidthMinPixels: 1,
      });
    }

    case 'particle': {
      const particleColor = toPastelColor(parseColor(config.style.color) ?? [126, 228, 240, 190], {
        mix: 0.34,
        alphaScale: 0.82,
      });
      return new ScatterplotLayer({
        ...baseProps,
        getPosition: (d: GeoJSON.Feature) => featureToPoint(d),
        getRadius: (d: GeoJSON.Feature) => {
          const props = d.properties as Record<string, unknown>;
          const speed = Number(props?.speedKph ?? props?.windKph ?? props?.speed ?? 0);
          return Math.max(config.style.radius ?? 300, speed * 22) * lodStyle.radiusScale;
        },
        radiusMinPixels: 2,
        radiusMaxPixels: 22,
        stroked: false,
        opacity: (config.style.opacity ?? 0.68) * lodStyle.opacity,
        getFillColor: particleColor,
      });
    }

    default: {
      const defaultBase = parseColor(config.style.color) ?? [120, 186, 255, 160];
      return new GeoJsonLayer({
        ...baseProps,
        data: { type: 'FeatureCollection' as const, features },
        getFillColor: toPastelColor(defaultBase, { mix: 0.42, alphaScale: 0.5 }),
        getLineColor: toPastelColor(defaultBase, { mix: 0.3, alphaScale: 0.88 }),
        lineWidthMinPixels: 1,
      });
    }
  }
}
