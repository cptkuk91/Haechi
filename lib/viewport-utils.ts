// 뷰포트 기반 필터링 + LOD(Level of Detail) 유틸리티
// 맵 경계 밖 피처를 제거하고, 줌 레벨에 따른 세부도를 조절

export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

// LOD 단계 — 줌에 따른 렌더링 전략
export type LODLevel = 'overview' | 'city' | 'district' | 'street';

export function getLODLevel(zoom: number): LODLevel {
  if (zoom < 8) return 'overview';    // 전국 뷰
  if (zoom < 11) return 'city';       // 도시 레벨
  if (zoom < 14) return 'district';   // 구/동 레벨
  return 'street';                    // 거리 레벨
}

// LOD별 최대 피처 수 — GPU 과부하 방지
const LOD_FEATURE_LIMITS: Record<LODLevel, number> = {
  overview: 200,
  city: 500,
  district: 1500,
  street: 5000,
};

// LOD별 스타일 스케일 팩터
export interface LODStyle {
  radiusScale: number;
  lineWidthScale: number;
  opacity: number;
  maxFeatures: number;
}

export function getLODStyle(lod: LODLevel): LODStyle {
  switch (lod) {
    case 'overview':
      return { radiusScale: 2.0, lineWidthScale: 0.5, opacity: 0.6, maxFeatures: 200 };
    case 'city':
      return { radiusScale: 1.2, lineWidthScale: 0.8, opacity: 0.7, maxFeatures: 500 };
    case 'district':
      return { radiusScale: 1.0, lineWidthScale: 1.0, opacity: 0.8, maxFeatures: 1500 };
    case 'street':
      return { radiusScale: 0.8, lineWidthScale: 1.2, opacity: 0.9, maxFeatures: 5000 };
  }
}

// 피처의 대표 좌표 추출 (Point → 좌표, Line/Polygon → 첫 좌표)
function getFeatureCoord(feature: GeoJSON.Feature): [number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;

  switch (geom.type) {
    case 'Point':
      return [geom.coordinates[0], geom.coordinates[1]];
    case 'MultiPoint':
      return geom.coordinates[0]
        ? [geom.coordinates[0][0], geom.coordinates[0][1]]
        : null;
    case 'LineString':
      return geom.coordinates[0]
        ? [geom.coordinates[0][0], geom.coordinates[0][1]]
        : null;
    case 'Polygon':
      return geom.coordinates[0]?.[0]
        ? [geom.coordinates[0][0][0], geom.coordinates[0][0][1]]
        : null;
    default:
      return null;
  }
}

// 좌표가 뷰포트 경계 내부인지 확인 (패딩 포함)
function isInBounds(coord: [number, number], bounds: ViewportBounds, padding = 0.05): boolean {
  const padLng = (bounds.east - bounds.west) * padding;
  const padLat = (bounds.north - bounds.south) * padding;
  return (
    coord[0] >= bounds.west - padLng &&
    coord[0] <= bounds.east + padLng &&
    coord[1] >= bounds.south - padLat &&
    coord[1] <= bounds.north + padLat
  );
}

// 뷰포트 내 피처만 필터링 + LOD 샘플링
export function filterByViewport(
  features: GeoJSON.Feature[],
  bounds: ViewportBounds,
  lod: LODLevel
): GeoJSON.Feature[] {
  const limit = LOD_FEATURE_LIMITS[lod];

  // 1. 뷰포트 바운드 필터링
  // Polygon/Line 타입은 경계선이 뷰포트와 교차할 수 있으므로 항상 포함
  const filtered = features.filter((f) => {
    if (!f.geometry) return false;
    const type = f.geometry.type;

    // Polygon, MultiPolygon, LineString은 뷰포트 밖에서도 교차 가능 → 완화된 필터
    if (type === 'Polygon' || type === 'MultiPolygon' || type === 'LineString' || type === 'MultiLineString') {
      return true; // 복잡한 교차 검사 대신 항상 통과 (deck.gl 자체 클리핑 위임)
    }

    const coord = getFeatureCoord(f);
    if (!coord) return false;
    return isInBounds(coord, bounds);
  });

  // 2. LOD 기반 샘플링 — 피처 수가 한계 초과 시 균등 샘플링
  if (filtered.length <= limit) return filtered;

  const step = filtered.length / limit;
  const sampled: GeoJSON.Feature[] = [];
  for (let i = 0; i < limit; i++) {
    sampled.push(filtered[Math.floor(i * step)]);
  }
  return sampled;
}

// GeoJSON FeatureCollection에 뷰포트 필터링 적용
export function filterFeatureCollection(
  fc: GeoJSON.FeatureCollection,
  bounds: ViewportBounds,
  zoom: number
): GeoJSON.FeatureCollection {
  const lod = getLODLevel(zoom);
  return {
    type: 'FeatureCollection',
    features: filterByViewport(fc.features, bounds, lod),
  };
}

// Mapbox GL Map에서 뷰포트 바운드 추출
export function getMapBounds(map: mapboxgl.Map): ViewportBounds {
  const bounds = map.getBounds();
  if (!bounds) {
    // Mapbox 타입 정의상 null 가능성이 있어 한국 기본 영역으로 폴백한다.
    return { west: 124, south: 33, east: 132, north: 39 };
  }
  return {
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  };
}
