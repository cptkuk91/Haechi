import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { clampInt, compactText, toPositiveInt } from '@/app/api/_shared/parse-primitives';
import { listHiddenUticIds } from '@/app/api/cctv/_shared/availability-cache';
import {
  fetchUticItems,
  getUticCoordinates,
  getUticId,
  isTrafficQualifiedUticItem,
  scoreByDistance,
  toText,
  type UticCctvItem,
} from '@/app/api/cctv/_shared/utic';

const SOURCE_LABEL = '출처: 경찰청 도시교통정보센터(UTIC)';
const SEOUL_COORDINATE: [number, number] = [126.978, 37.5665];
const DEFAULT_MAX_FEATURES = 100;
const MIN_MAX_FEATURES = 1;
const MAX_MAX_FEATURES = 5_000;

export const runtime = 'nodejs';

function parseBboxQueryParam(raw: string | null): { west: number; south: number; east: number; north: number } | null {
  if (!raw) return null;
  const [westRaw, southRaw, eastRaw, northRaw] = raw.split(',');
  if (!westRaw || !southRaw || !eastRaw || !northRaw) return null;

  const west = Number(westRaw);
  const south = Number(southRaw);
  const east = Number(eastRaw);
  const north = Number(northRaw);

  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;

  return { west, south, east, north };
}

function includesCoordinate(
  bbox: { west: number; south: number; east: number; north: number } | null,
  coord: [number, number]
): boolean {
  if (!bbox) return true;
  const [lng, lat] = coord;
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

function getReferenceCoordinate(
  bbox: { west: number; south: number; east: number; north: number } | null
): [number, number] {
  if (!bbox) return SEOUL_COORDINATE;
  return [(bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2];
}

function toFeature(item: UticCctvItem): GeoJSON.Feature | null {
  const uticId = getUticId(item);
  const coordinates = getUticCoordinates(item);
  if (!uticId || !coordinates) return null;

  const name = compactText(toText(item.CCTVNAME) ?? uticId);
  const kind = toText(item.KIND);

  return {
    type: 'Feature',
    id: uticId,
    geometry: {
      type: 'Point',
      coordinates,
    },
    properties: {
      name,
      cctvname: name,
      cctvId: uticId,
      uticId,
      kind,
      cctvType: 'traffic',
      status: 'active',
      source: 'utic',
      sourceLabel: SOURCE_LABEL,
      matchMode: 'direct-utic',
      streamUrl: null,
    },
  };
}

export async function GET(request: Request) {
  const key = toText(process.env.TEAM2_UTIC_CCTV_API_KEY);
  if (!key) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: ['Missing env: TEAM2_UTIC_CCTV_API_KEY'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const url = new URL(request.url);
  const requestedBbox = parseBboxQueryParam(url.searchParams.get('bbox'));
  const maxFeatures = clampInt(
    toPositiveInt(url.searchParams.get('max'), DEFAULT_MAX_FEATURES),
    MIN_MAX_FEATURES,
    MAX_MAX_FEATURES
  );

  const warnings: string[] = [];
  const [{ items, warning }, hiddenUticIds] = await Promise.all([
    fetchUticItems(key),
    listHiddenUticIds(),
  ]);

  if (warning) {
    warnings.push(warning);
  }

  const referenceCoordinate = getReferenceCoordinate(requestedBbox);
  const features = items
    .filter(isTrafficQualifiedUticItem)
    .filter((item) => {
      const uticId = getUticId(item);
      return uticId ? !hiddenUticIds.has(uticId) : false;
    })
    .map((item) => ({
      item,
      coordinates: getUticCoordinates(item),
    }))
    .filter(
      (entry): entry is { item: UticCctvItem; coordinates: [number, number] } => Boolean(entry.coordinates)
    )
    .filter((entry) => includesCoordinate(requestedBbox, entry.coordinates))
    .sort((a, b) => {
      const aDistance = scoreByDistance(a.item, referenceCoordinate[0], referenceCoordinate[1]);
      const bDistance = scoreByDistance(b.item, referenceCoordinate[0], referenceCoordinate[1]);
      if (aDistance !== bDistance) return aDistance - bDistance;
      const aName = toText(a.item.CCTVNAME) ?? '';
      const bName = toText(b.item.CCTVNAME) ?? '';
      return aName.localeCompare(bName, 'ko');
    })
    .slice(0, maxFeatures)
    .map((entry) => toFeature(entry.item))
    .filter((feature): feature is GeoJSON.Feature => Boolean(feature));

  if (hiddenUticIds.size > 0) {
    warnings.push(`Suppressed ${hiddenUticIds.size} recently failed UTIC CCTV marker(s)`);
  }

  if (features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: warnings.length > 0 ? warnings : ['UTIC CCTV returned no usable traffic features'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  return NextResponse.json(
    {
      source: 'upstream',
      updatedAt: new Date().toISOString(),
      data: {
        type: 'FeatureCollection',
        features,
      } satisfies GeoJSON.FeatureCollection,
      warnings,
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': 'upstream',
      },
    }
  );
}
