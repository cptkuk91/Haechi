const EARTH_RADIUS_METERS = 6_371_008.8;
const NAUTICAL_MILE_METERS = 1_852;

export const DEFAULT_MARITIME_SEATN_TNZONE = '04';
export const DEFAULT_MARITIME_SEATN_PAGE_SIZE = 100;

export function parseSeatnDms(raw: string | null): number | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase().replace(/\s+/g, '');
  const match = normalized.match(/^(\d+)-(\d+)-(\d+(?:\.\d+)?)([NSEW])$/);
  if (!match) return null;

  const [, degreeRaw, minuteRaw, secondRaw, direction] = match;
  const degrees = Number(degreeRaw);
  const minutes = Number(minuteRaw);
  const seconds = Number(secondRaw);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;

  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (direction === 'S' || direction === 'W') {
    decimal *= -1;
  }
  return decimal;
}

export function parseSeatnCoordinatePair(raw: string): [number, number] | null {
  const [latRaw, lngRaw] = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (!latRaw || !lngRaw) return null;

  const lat = parseSeatnDms(latRaw);
  const lng = parseSeatnDms(lngRaw);
  if (lat === null || lng === null) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;

  return [lng, lat];
}

export function parseSeatnZoneCoordinates(raw: string | null): [number, number][] {
  if (!raw) return [];

  const coordinates: [number, number][] = [];
  let previousKey: string | null = null;

  for (const line of raw.split(/\r?\n+/)) {
    const normalized = line.trim();
    if (!normalized) continue;

    const coordinate = parseSeatnCoordinatePair(normalized);
    if (!coordinate) continue;

    const key = `${coordinate[0].toFixed(6)},${coordinate[1].toFixed(6)}`;
    if (previousKey === key) continue;
    previousKey = key;
    coordinates.push(coordinate);
  }

  return coordinates;
}

export function closeSeatnRing(coordinates: [number, number][]): [number, number][] {
  if (coordinates.length === 0) return [];
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coordinates;
  return [...coordinates, first];
}

export function extractSeatnRadiusNm(zoneDesc: string | null): number | null {
  if (!zoneDesc) return null;
  const match = zoneDesc.match(/반경\s*(\d+(?:\.\d+)?)\s*NM/i);
  if (!match) return null;
  const radiusNm = Number(match[1]);
  return Number.isFinite(radiusNm) ? radiusNm : null;
}

export function buildSeatnCircleRing(
  center: [number, number],
  radiusNm: number,
  steps = 48
): [number, number][] {
  const radiusMeters = radiusNm * NAUTICAL_MILE_METERS;
  const [centerLng, centerLat] = center;
  const centerLatRad = centerLat * (Math.PI / 180);
  const ring: [number, number][] = [];

  for (let index = 0; index <= steps; index += 1) {
    const theta = (index / steps) * Math.PI * 2;
    const deltaX = radiusMeters * Math.cos(theta);
    const deltaY = radiusMeters * Math.sin(theta);

    const lat = centerLat + (deltaY / EARTH_RADIUS_METERS) * (180 / Math.PI);
    const lng = centerLng + (deltaX / (EARTH_RADIUS_METERS * Math.cos(centerLatRad))) * (180 / Math.PI);
    ring.push([lng, lat]);
  }

  return ring;
}
