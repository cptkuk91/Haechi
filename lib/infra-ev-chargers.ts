import type { MapBounds } from '@/stores/app-store';

export const DEFAULT_INFRA_EV_CHARGER_FEATURE_LIMIT = 420;
export const MIN_INFRA_EV_CHARGER_FEATURE_LIMIT = 80;
export const MAX_INFRA_EV_CHARGER_FEATURE_LIMIT = 1600;
export const DEFAULT_INFRA_EV_CHARGER_MAX_PAGES = 4;
export const MIN_INFRA_EV_CHARGER_MAX_PAGES = 1;
export const MAX_INFRA_EV_CHARGER_MAX_PAGES = 12;

export interface InfraEvChargerBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface InfraEvChargerRegion {
  code: string;
  label: string;
  bbox: InfraEvChargerBbox;
}

export const INFRA_EV_CHARGER_REGIONS: InfraEvChargerRegion[] = [
  { code: '11', label: '서울', bbox: { west: 126.76, south: 37.42, east: 127.18, north: 37.72 } },
  { code: '26', label: '부산', bbox: { west: 128.74, south: 34.88, east: 129.37, north: 35.39 } },
  { code: '27', label: '대구', bbox: { west: 128.38, south: 35.62, east: 128.77, north: 36.02 } },
  { code: '28', label: '인천', bbox: { west: 124.58, south: 37.19, east: 126.93, north: 37.97 } },
  { code: '29', label: '광주', bbox: { west: 126.74, south: 35.05, east: 127.00, north: 35.23 } },
  { code: '30', label: '대전', bbox: { west: 127.26, south: 36.20, east: 127.56, north: 36.49 } },
  { code: '31', label: '울산', bbox: { west: 129.00, south: 35.35, east: 129.47, north: 35.75 } },
  { code: '36', label: '세종', bbox: { west: 127.18, south: 36.44, east: 127.38, north: 36.66 } },
  { code: '41', label: '경기', bbox: { west: 126.33, south: 36.89, east: 127.85, north: 38.62 } },
  { code: '42', label: '강원', bbox: { west: 127.02, south: 37.02, east: 129.36, north: 38.61 } },
  { code: '43', label: '충북', bbox: { west: 127.27, south: 36.00, east: 128.67, north: 37.25 } },
  { code: '44', label: '충남', bbox: { west: 125.98, south: 35.97, east: 127.72, north: 37.04 } },
  { code: '45', label: '전북', bbox: { west: 126.46, south: 35.16, east: 127.95, north: 36.14 } },
  { code: '46', label: '전남', bbox: { west: 125.05, south: 33.80, east: 127.95, north: 35.45 } },
  { code: '47', label: '경북', bbox: { west: 128.10, south: 35.46, east: 130.92, north: 37.32 } },
  { code: '48', label: '경남', bbox: { west: 127.57, south: 34.56, east: 129.04, north: 35.91 } },
  { code: '50', label: '제주', bbox: { west: 126.08, south: 33.10, east: 126.98, north: 33.59 } },
];

export function clampInfraEvChargerFeatureLimit(value: number): number {
  return Math.min(
    MAX_INFRA_EV_CHARGER_FEATURE_LIMIT,
    Math.max(MIN_INFRA_EV_CHARGER_FEATURE_LIMIT, Math.floor(value))
  );
}

export function clampInfraEvChargerMaxPages(value: number): number {
  return Math.min(
    MAX_INFRA_EV_CHARGER_MAX_PAGES,
    Math.max(MIN_INFRA_EV_CHARGER_MAX_PAGES, Math.floor(value))
  );
}

export function getInfraEvChargerFeatureLimitForZoom(zoom: number): number {
  if (zoom < 6) return 140;
  if (zoom < 7.5) return 260;
  if (zoom < 9) return 420;
  if (zoom < 10.5) return 700;
  return 1200;
}

export function buildInfraEvChargerCandidateTarget(
  featureLimit: number,
  bboxApplied: boolean
): number {
  const normalizedLimit = clampInfraEvChargerFeatureLimit(featureLimit);
  const multiplier = bboxApplied ? 1.8 : 1.3;
  return clampInfraEvChargerFeatureLimit(Math.ceil(normalizedLimit * multiplier));
}

export function buildInfraEvChargerMaxPages(
  featureLimit: number,
  bboxApplied: boolean
): number {
  const normalizedLimit = clampInfraEvChargerFeatureLimit(featureLimit);

  if (bboxApplied) {
    if (normalizedLimit <= 140) return 2;
    if (normalizedLimit <= 260) return 3;
    if (normalizedLimit <= 420) return 4;
    if (normalizedLimit <= 700) return 5;
    return 6;
  }

  if (normalizedLimit <= 140) return 1;
  if (normalizedLimit <= 260) return 2;
  if (normalizedLimit <= 420) return 2;
  if (normalizedLimit <= 700) return 3;
  return DEFAULT_INFRA_EV_CHARGER_MAX_PAGES;
}

export function formatInfraEvChargerBbox(bounds: MapBounds | null): string | null {
  if (!bounds) return null;
  return [
    bounds.west.toFixed(5),
    bounds.south.toFixed(5),
    bounds.east.toFixed(5),
    bounds.north.toFixed(5),
  ].join(',');
}

export function parseInfraEvChargerBbox(raw: string | null): InfraEvChargerBbox | null {
  if (!raw) return null;
  const parts = raw.split(',').map((value) => Number(value.trim()));
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function includesInfraEvChargerCoordinate(
  bbox: InfraEvChargerBbox | null,
  coordinates: GeoJSON.Position
): boolean {
  if (!bbox) return true;
  const [lng, lat] = coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  return (
    lng >= bbox.west
    && lng <= bbox.east
    && lat >= bbox.south
    && lat <= bbox.north
  );
}

function intersects(left: InfraEvChargerBbox, right: InfraEvChargerBbox): boolean {
  return !(
    left.east < right.west
    || left.west > right.east
    || left.north < right.south
    || left.south > right.north
  );
}

export function getInfraEvChargerRegionCodesForBbox(bbox: InfraEvChargerBbox | null): string[] {
  if (!bbox) return INFRA_EV_CHARGER_REGIONS.map((region) => region.code);

  const width = bbox.east - bbox.west;
  const height = bbox.north - bbox.south;
  const centerLng = (bbox.west + bbox.east) / 2;
  const centerLat = (bbox.south + bbox.north) / 2;
  const localMetroRegionCodes = new Set(['11', '26', '27', '28', '29', '30', '31', '36', '50']);

  const matched = INFRA_EV_CHARGER_REGIONS
    .filter((region) => intersects(region.bbox, bbox))
    .map((region) => region.code);

  if (width <= 0.9 && height <= 0.9) {
    const containing = INFRA_EV_CHARGER_REGIONS
      .filter((region) =>
        centerLng >= region.bbox.west
        && centerLng <= region.bbox.east
        && centerLat >= region.bbox.south
        && centerLat <= region.bbox.north
      )
      .sort((left, right) => {
        const leftArea = (left.bbox.east - left.bbox.west) * (left.bbox.north - left.bbox.south);
        const rightArea = (right.bbox.east - right.bbox.west) * (right.bbox.north - right.bbox.south);
        return leftArea - rightArea;
      });

    const smallest = containing[0];
    if (smallest && localMetroRegionCodes.has(smallest.code)) {
      return [smallest.code];
    }
  }

  return matched.length > 0 ? matched : INFRA_EV_CHARGER_REGIONS.map((region) => region.code);
}

export function getInfraEvChargerRegionLabel(regionCode: string | null): string | null {
  if (!regionCode) return null;
  return INFRA_EV_CHARGER_REGIONS.find((region) => region.code === regionCode)?.label ?? null;
}

export function describeInfraEvChargerStatus(code: string | null): string | null {
  switch (code) {
    case '1':
      return '통신 이상';
    case '2':
      return '사용 가능';
    case '3':
      return '충전 중';
    case '4':
      return '운영 중지';
    case '5':
      return '점검 중';
    case '9':
      return '상태 미확인';
    default:
      return code ? `상태코드 ${code}` : null;
  }
}
