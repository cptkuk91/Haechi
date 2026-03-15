import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  AIR_STATION_REGION_QUERIES,
  loadAirStationDataset,
  type AirStationFeature,
} from '@/app/api/weather/_shared/air-quality-stations-dataset';
import {
  clampWeatherAirHeatmapFeatureLimit,
  DEFAULT_WEATHER_AIR_HEATMAP_FEATURE_LIMIT,
} from '@/lib/weather-air-quality-heatmap';
import {
  includesWeatherAirStationCoordinate,
  parseWeatherAirStationBbox,
  type WeatherAirStationBbox,
} from '@/lib/weather-air-quality-stations';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty';
const DEFAULT_PAGE_SIZE = 200;
const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;
const SUCCESS_CODES = new Set(['00', 'NORMAL_CODE']);

interface MeasurementPageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

type AirHeatFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    id: string;
    layerKind: 'air-quality-heatmap';
    name: string;
    stationName: string;
    address: string | null;
    monitoringNetwork: string | null;
    observationItems: string | null;
    regionLabel: string | null;
    regionCode: string | null;
    dataTime: string | null;
    pm10Value: number | null;
    pm25Value: number | null;
    pm10Grade: number | null;
    pm25Grade: number | null;
    khaiValue: number | null;
    weight: number;
    source: 'upstream';
    sourceLabel: string;
  }
>;

interface AirHeatCache {
  features: AirHeatFeature[];
  warnings: string[];
  fetchedAt: number;
}

let heatCache: AirHeatCache | null = null;

function toNullableGrade(row: JsonRecord, key: string): number | null {
  const value = pickNumber(row, [key]);
  if (value === null) return null;
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeHeatWeight(args: {
  pm10Value: number | null;
  pm25Value: number | null;
  khaiValue: number | null;
}): number | null {
  const pm10Score = args.pm10Value !== null ? args.pm10Value / 150 : null;
  const pm25Score = args.pm25Value !== null ? args.pm25Value / 75 : null;
  const khaiScore = args.khaiValue !== null ? args.khaiValue / 250 : null;

  const candidates = [pm10Score, pm25Score, khaiScore].filter((value): value is number => value !== null);
  if (candidates.length === 0) return null;
  return clamp(Math.max(...candidates), 0.08, 1.6);
}

async function fetchMeasurementPage(args: {
  apiKey: string;
  upstreamUrl: string;
  regionCode: string;
  pageNo: number;
  pageSize: number;
}): Promise<MeasurementPageFetchResult> {
  const url = new URL(args.upstreamUrl);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('returnType', 'json');
  url.searchParams.set('numOfRows', String(args.pageSize));
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('sidoName', args.regionCode);
  url.searchParams.set('ver', '1.0');

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      rows: [],
      totalCount: null,
      warning: `air quality upstream responded ${response.status} for ${args.regionCode}`,
    };
  }

  const raw = (await response.json()) as unknown;
  const warning = extractResultWarningFromCommonJson(raw, `air quality API (${args.regionCode})`, SUCCESS_CODES) ?? undefined;

  return {
    rows: extractRowsFromCommonJson(raw),
    totalCount: extractTotalCountFromCommonJson(raw),
    warning,
  };
}

function buildStationLookup(stations: AirStationFeature[]) {
  const byRegionAndName = new Map<string, AirStationFeature>();
  const byName = new Map<string, AirStationFeature>();
  const duplicatedNames = new Set<string>();

  for (const station of stations) {
    const stationName = station.properties.stationName;
    const regionCode = station.properties.regionCode ?? '';
    byRegionAndName.set(`${regionCode}|${stationName}`, station);

    if (byName.has(stationName)) duplicatedNames.add(stationName);
    else byName.set(stationName, station);
  }

  return {
    resolve(regionCode: string | null, stationName: string): AirStationFeature | null {
      if (regionCode) {
        const byRegion = byRegionAndName.get(`${regionCode}|${stationName}`);
        if (byRegion) return byRegion;
      }

      if (!duplicatedNames.has(stationName)) {
        return byName.get(stationName) ?? null;
      }

      return null;
    },
  };
}

function rowToHeatFeature(row: JsonRecord, station: AirStationFeature): AirHeatFeature | null {
  const pm10Value = pickNumber(row, ['pm10Value']);
  const pm25Value = pickNumber(row, ['pm25Value']);
  const khaiValue = pickNumber(row, ['khaiValue']);
  const weight = computeHeatWeight({ pm10Value, pm25Value, khaiValue });
  if (weight === null) return null;

  return {
    type: 'Feature',
    id: `${station.properties.regionCode ?? 'unknown'}:${station.properties.stationName}:${pickString(row, ['dataTime']) ?? 'now'}`,
    geometry: station.geometry,
    properties: {
      id: `${station.properties.regionCode ?? 'unknown'}:${station.properties.stationName}`,
      layerKind: 'air-quality-heatmap',
      name: station.properties.name,
      stationName: station.properties.stationName,
      address: station.properties.address,
      monitoringNetwork: station.properties.monitoringNetwork,
      observationItems: station.properties.observationItems,
      regionLabel: station.properties.regionLabel,
      regionCode: station.properties.regionCode,
      dataTime: pickString(row, ['dataTime']),
      pm10Value,
      pm25Value,
      pm10Grade: toNullableGrade(row, 'pm10Grade'),
      pm25Grade: toNullableGrade(row, 'pm25Grade'),
      khaiValue,
      weight,
      source: 'upstream',
      sourceLabel: '에어코리아 대기오염정보',
    },
  };
}

function sortHeatFeatures(features: AirHeatFeature[]): AirHeatFeature[] {
  return [...features].sort((left, right) => {
    if (left.properties.weight !== right.properties.weight) {
      return right.properties.weight - left.properties.weight;
    }
    return left.properties.name.localeCompare(right.properties.name, 'ko');
  });
}

async function loadAirHeatDataset(args: {
  apiKey: string;
  upstreamUrl: string;
  stations: AirStationFeature[];
}): Promise<AirHeatCache> {
  const now = Date.now();
  if (heatCache && now - heatCache.fetchedAt < RESPONSE_CACHE_TTL_MS) {
    return heatCache;
  }

  const warnings: string[] = [];
  const heatMap = new Map<string, AirHeatFeature>();
  const stationLookup = buildStationLookup(args.stations);

  for (const region of AIR_STATION_REGION_QUERIES) {
    const firstPage = await fetchMeasurementPage({
      apiKey: args.apiKey,
      upstreamUrl: args.upstreamUrl,
      regionCode: region.regionCode,
      pageNo: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });

    if (firstPage.warning) warnings.push(firstPage.warning);

    const totalCount = firstPage.totalCount ?? firstPage.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / DEFAULT_PAGE_SIZE));
    const rows = [...firstPage.rows];

    for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
      const page = await fetchMeasurementPage({
        apiKey: args.apiKey,
        upstreamUrl: args.upstreamUrl,
        regionCode: region.regionCode,
        pageNo,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      if (page.warning) warnings.push(page.warning);
      rows.push(...page.rows);
    }

    for (const row of rows) {
      const stationName = pickString(row, ['stationName']);
      if (!stationName) continue;

      const station = stationLookup.resolve(region.regionCode, stationName);
      if (!station) {
        warnings.push(`No station coordinate match for ${region.regionCode}:${stationName}`);
        continue;
      }

      const feature = rowToHeatFeature(row, station);
      if (!feature) continue;
      heatMap.set(String(feature.id), feature);
    }
  }

  const nextCache: AirHeatCache = {
    features: sortHeatFeatures([...heatMap.values()]),
    warnings: Array.from(new Set(warnings)),
    fetchedAt: now,
  };

  if (nextCache.features.length > 0) {
    heatCache = nextCache;
    return nextCache;
  }

  if (heatCache) {
    return {
      ...heatCache,
      warnings: Array.from(new Set([
        ...heatCache.warnings,
        ...warnings,
        'Using stale air quality heatmap cache after upstream refresh failure',
      ])),
    };
  }

  return nextCache;
}

function filterHeatFeatures(args: {
  features: AirHeatFeature[];
  bbox: WeatherAirStationBbox | null;
  limit: number;
}): AirHeatFeature[] {
  return args.features
    .filter((feature) => includesWeatherAirStationCoordinate(args.bbox, feature.geometry.coordinates))
    .slice(0, args.limit);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const bbox = parseWeatherAirStationBbox(requestUrl.searchParams.get('bbox'));
  const featureLimit = clampWeatherAirHeatmapFeatureLimit(
    toPositiveInt(requestUrl.searchParams.get('limit'), DEFAULT_WEATHER_AIR_HEATMAP_FEATURE_LIMIT)
  );

  const stationApiKey =
    process.env.TEAM2_WEATHER_AIR_QUALITY_STATIONS_API_KEY
    ?? process.env.TEAM2_WEATHER_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;
  const measurementApiKey =
    process.env.TEAM2_WEATHER_AIR_QUALITY_MEASUREMENTS_API_KEY
    ?? process.env.TEAM2_WEATHER_AIR_QUALITY_STATIONS_API_KEY
    ?? process.env.TEAM2_WEATHER_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!stationApiKey || !measurementApiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        totalCount: 0,
        matchedCount: 0,
        data: emptyFeatureCollection(),
        warnings: [
          'Missing env: TEAM2_WEATHER_AIR_QUALITY_MEASUREMENTS_API_KEY (or TEAM2_WEATHER_AIR_QUALITY_STATIONS_API_KEY / TEAM2_WEATHER_API_KEY / TEAM2_PUBLIC_API_KEY)',
        ],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  const stationDataset = await loadAirStationDataset({
    apiKey: stationApiKey,
    upstreamUrl: process.env.TEAM2_WEATHER_AIR_QUALITY_STATIONS_UPSTREAM_URL
      ?? 'https://apis.data.go.kr/B552584/MsrstnInfoInqireSvc/getMsrstnList',
  });

  const heatDataset = await loadAirHeatDataset({
    apiKey: measurementApiKey,
    upstreamUrl: process.env.TEAM2_WEATHER_AIR_QUALITY_MEASUREMENTS_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL,
    stations: stationDataset.features,
  });

  const visibleFeatures = filterHeatFeatures({
    features: heatDataset.features,
    bbox,
    limit: featureLimit,
  });

  const matchedCount = heatDataset.features.filter((feature) =>
    includesWeatherAirStationCoordinate(bbox, feature.geometry.coordinates)
  ).length;

  const source: 'mock' | 'upstream' = heatDataset.features.length > 0 ? 'upstream' : 'mock';

  return NextResponse.json(
    {
      source,
      updatedAt: new Date(heatDataset.fetchedAt).toISOString(),
      totalCount: heatDataset.features.length,
      matchedCount,
      data: {
        type: 'FeatureCollection',
        features: visibleFeatures,
      },
      meta: {
        featureLimit,
        featureCount: visibleFeatures.length,
        bboxApplied: Boolean(bbox),
        weightFormula: 'max(pm10/150, pm25/75, khai/250)',
      },
      warnings: Array.from(new Set([
        ...stationDataset.warnings,
        ...heatDataset.warnings,
      ])),
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': source,
      },
    }
  );
}
