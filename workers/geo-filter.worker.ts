// Web Worker — 메인 스레드 차단 없이 GeoJSON 뷰포트 필터링 수행
// 대량 피처(군중 밀집, 히트맵 등)의 공간 필터링을 오프로드

interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

type LODLevel = 'overview' | 'city' | 'district' | 'street';

interface FilterRequest {
  type: 'filter';
  id: string; // 레이어 ID
  features: GeoJSON.Feature[];
  bounds: ViewportBounds;
  zoom: number;
}

interface FilterResponse {
  type: 'filtered';
  id: string;
  features: GeoJSON.Feature[];
  originalCount: number;
  filteredCount: number;
  processingTime: number;
}

const LOD_LIMITS: Record<LODLevel, number> = {
  overview: 200,
  city: 500,
  district: 1500,
  street: 5000,
};

function getLOD(zoom: number): LODLevel {
  if (zoom < 8) return 'overview';
  if (zoom < 11) return 'city';
  if (zoom < 14) return 'district';
  return 'street';
}

function getCoord(feature: GeoJSON.Feature): [number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type === 'Point') return [geom.coordinates[0], geom.coordinates[1]];
  if (geom.type === 'LineString' && geom.coordinates[0]) return [geom.coordinates[0][0], geom.coordinates[0][1]];
  if (geom.type === 'Polygon' && geom.coordinates[0]?.[0]) return [geom.coordinates[0][0][0], geom.coordinates[0][0][1]];
  return null;
}

function filterFeatures(features: GeoJSON.Feature[], bounds: ViewportBounds, zoom: number): GeoJSON.Feature[] {
  const lod = getLOD(zoom);
  const limit = LOD_LIMITS[lod];
  const padLng = (bounds.east - bounds.west) * 0.05;
  const padLat = (bounds.north - bounds.south) * 0.05;

  // 공간 필터링
  const filtered = features.filter((f) => {
    if (!f.geometry) return false;
    const type = f.geometry.type;

    // 라인/폴리곤은 뷰포트 교차 가능 → 항상 통과
    if (type === 'Polygon' || type === 'MultiPolygon' || type === 'LineString' || type === 'MultiLineString') {
      return true;
    }

    const coord = getCoord(f);
    if (!coord) return false;
    return (
      coord[0] >= bounds.west - padLng &&
      coord[0] <= bounds.east + padLng &&
      coord[1] >= bounds.south - padLat &&
      coord[1] <= bounds.north + padLat
    );
  });

  // LOD 샘플링
  if (filtered.length <= limit) return filtered;

  const step = filtered.length / limit;
  const sampled: GeoJSON.Feature[] = [];
  for (let i = 0; i < limit; i++) {
    sampled.push(filtered[Math.floor(i * step)]);
  }
  return sampled;
}

// Worker 메시지 핸들러
self.onmessage = (e: MessageEvent<FilterRequest>) => {
  const { type, id, features, bounds, zoom } = e.data;

  if (type === 'filter') {
    const start = performance.now();
    const result = filterFeatures(features, bounds, zoom);
    const elapsed = performance.now() - start;

    const response: FilterResponse = {
      type: 'filtered',
      id,
      features: result,
      originalCount: features.length,
      filteredCount: result.length,
      processingTime: elapsed,
    };

    self.postMessage(response);
  }
};
