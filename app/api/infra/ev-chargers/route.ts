import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import { clampInt, toNumber, toPositiveInt } from '@/app/api/_shared/parse-primitives';
import {
  extractResultWarningFromXml,
  extractXmlItems,
  extractXmlTagValue,
} from '@/app/api/_shared/xml-utils';
import {
  buildInfraEvChargerCandidateTarget,
  buildInfraEvChargerMaxPages,
  clampInfraEvChargerFeatureLimit,
  clampInfraEvChargerMaxPages,
  getInfraEvChargerRegionCodesForBbox,
  getInfraEvChargerRegionLabel,
  includesInfraEvChargerCoordinate,
  parseInfraEvChargerBbox,
} from '@/lib/infra-ev-chargers';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo';
const DEFAULT_PAGE_SIZE = 9999;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 9999;
const DEFAULT_FEATURE_LIMIT = 420;
const REGION_CACHE_TTL_MS = 30 * 60 * 1000;
const REGION_BATCH_SIZE = 2;
const PAGE_BATCH_SIZE = 2;

interface RegionPageResult {
  itemXmlList: string[];
  totalCount: number | null;
  warning?: string;
}

interface RegionCacheEntry {
  features: EvChargerFeature[];
  totalChargers: number;
  fetchedPages: number;
  totalPages: number;
  partialFetch: boolean;
  warnings: string[];
  fetchedAt: number;
}

interface StationAggregate {
  stationId: string;
  name: string;
  regionCode: string;
  regionLabel: string | null;
  coordinates: [number, number];
  address: string | null;
  addressDetail: string | null;
  locationHint: string | null;
  useTime: string | null;
  agencyName: string | null;
  operatorName: string | null;
  operatorPhone: string | null;
  method: string | null;
  parkingFree: boolean | null;
  userLimit: boolean | null;
  userLimitDetail: string | null;
  trafficSupport: boolean | null;
  kind: string | null;
  kindDetail: string | null;
  totalChargers: number;
  availableCount: number;
  chargingCount: number;
  unavailableCount: number;
  maxOutputKw: number | null;
  outputValues: Set<number>;
  makers: Set<string>;
  chargerTypes: Set<string>;
  floorLabels: Set<string>;
  installedYears: Set<number>;
  latestStatusUpdatedAt: string | null;
  lastChargeStartedAt: string | null;
  lastChargeEndedAt: string | null;
  currentChargeStartedAt: string | null;
}

type EvChargerFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    id: string;
    layerKind: 'infra-ev-charger';
    name: string;
    stationId: string;
    regionCode: string | null;
    regionLabel: string | null;
    address: string | null;
    addressDetail: string | null;
    locationHint: string | null;
    useTime: string | null;
    agencyName: string | null;
    operatorName: string | null;
    operatorPhone: string | null;
    chargerMethod: string | null;
    totalChargers: number;
    availableCount: number;
    chargingCount: number;
    unavailableCount: number;
    availabilityStatus: 'available' | 'partial' | 'busy' | 'offline';
    availabilityLabel: string;
    latestStatusUpdatedAt: string | null;
    lastChargeStartedAt: string | null;
    lastChargeEndedAt: string | null;
    currentChargeStartedAt: string | null;
    maxOutputKw: number | null;
    outputSummary: string | null;
    makerSummary: string | null;
    chargerTypeSummary: string | null;
    floorSummary: string | null;
    installedYearSummary: string | null;
    parkingFree: boolean | null;
    parkingFreeLabel: string | null;
    userLimit: boolean | null;
    userLimitLabel: string | null;
    userLimitDetail: string | null;
    trafficSupport: boolean | null;
    trafficSupportLabel: string | null;
    kind: string | null;
    kindDetail: string | null;
    source: 'upstream';
    sourceLabel: string;
  }
>;

const regionCache = new Map<string, RegionCacheEntry>();

function cleanText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.toLowerCase() === 'null') return null;
  return normalized;
}

function toBoolFlag(value: string | null): boolean | null {
  if (!value) return null;
  if (value === 'Y') return true;
  if (value === 'N') return false;
  return null;
}

function combineAddress(primary: string | null, detail: string | null): string | null {
  if (primary && detail) return `${primary} ${detail}`;
  return primary ?? detail;
}

function formatDateTimeToken(value: string | null): string | null {
  const digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length >= 14) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
  }
  if (digits.length >= 12) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
  }
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return value;
}

function maxTimestamp(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function summarizeNumberSet(values: Set<number>, unit = ''): string | null {
  if (values.size === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.map((value) => `${value}${unit}`).join(' / ');
}

function summarizeTextSet(values: Set<string>): string | null {
  if (values.size === 0) return null;
  return [...values].sort((left, right) => left.localeCompare(right, 'ko')).join(', ');
}

function summarizeYearSet(values: Set<number>): string | null {
  if (values.size === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const latest = sorted[sorted.length - 1];
  return sorted[0] === latest
    ? String(sorted[0])
    : `${sorted[0]}-${latest}`;
}

async function fetchInfoPage(args: {
  apiKey: string;
  upstreamUrl: string;
  regionCode: string;
  pageNo: number;
  pageSize: number;
}): Promise<RegionPageResult> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const url = new URL(args.upstreamUrl);
    url.searchParams.set('ServiceKey', args.apiKey);
    url.searchParams.set('pageNo', String(args.pageNo));
    url.searchParams.set('numOfRows', String(args.pageSize));
    url.searchParams.set('zcode', args.regionCode);

    response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    });

    if (response.ok || response.status !== 429) {
      break;
    }

    await sleep(500 * (attempt + 1));
  }

  if (!response) {
    return {
      itemXmlList: [],
      totalCount: null,
      warning: `EV charger info upstream returned no response for region ${args.regionCode}`,
    };
  }

  if (!response.ok) {
    return {
      itemXmlList: [],
      totalCount: null,
      warning: `EV charger info upstream responded ${response.status} for region ${args.regionCode}`,
    };
  }

  const xml = await response.text();
  if (!xml.trim()) {
    return {
      itemXmlList: [],
      totalCount: null,
      warning: `EV charger info upstream returned empty body for region ${args.regionCode}`,
    };
  }

  const warning = extractResultWarningFromXml(xml, {
    sourceLabel: `EV charger info API (${args.regionCode})`,
    successCodes: new Set(['00']),
  }) ?? undefined;

  return {
    itemXmlList: extractXmlItems(xml, 'item'),
    totalCount: toPositiveInt(extractXmlTagValue(xml, 'totalCount'), 0) || null,
    warning,
  };
}

function appendStationItem(itemXml: string, regionCode: string, stationMap: Map<string, StationAggregate>): void {
  const stationId = cleanText(extractXmlTagValue(itemXml, 'statId'));
  const stationName = cleanText(extractXmlTagValue(itemXml, 'statNm')) ?? '전기차 충전소';
  const lng = toNumber(cleanText(extractXmlTagValue(itemXml, 'lng')));
  const lat = toNumber(cleanText(extractXmlTagValue(itemXml, 'lat')));
  const deleted = cleanText(extractXmlTagValue(itemXml, 'delYn')) === 'Y';

  if (!stationId || lng === null || lat === null) return;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return;
  if (deleted) return;

  const address = cleanText(extractXmlTagValue(itemXml, 'addr'));
  const addressDetail = cleanText(extractXmlTagValue(itemXml, 'addrDetail'));
  const locationHint = cleanText(extractXmlTagValue(itemXml, 'location'));
  const operatorName = cleanText(extractXmlTagValue(itemXml, 'busiNm'));
  const agencyName = cleanText(extractXmlTagValue(itemXml, 'bnm'));
  const regionLabel = getInfraEvChargerRegionLabel(regionCode);

  let aggregate = stationMap.get(stationId);
  if (!aggregate) {
    aggregate = {
      stationId,
      name: stationName,
      regionCode,
      regionLabel,
      coordinates: [lng, lat],
      address,
      addressDetail,
      locationHint,
      useTime: cleanText(extractXmlTagValue(itemXml, 'useTime')),
      agencyName,
      operatorName,
      operatorPhone: cleanText(extractXmlTagValue(itemXml, 'busiCall')),
      method: cleanText(extractXmlTagValue(itemXml, 'method')),
      parkingFree: toBoolFlag(cleanText(extractXmlTagValue(itemXml, 'parkingFree'))),
      userLimit: toBoolFlag(cleanText(extractXmlTagValue(itemXml, 'limitYn'))),
      userLimitDetail: cleanText(extractXmlTagValue(itemXml, 'limitDetail')),
      trafficSupport: toBoolFlag(cleanText(extractXmlTagValue(itemXml, 'trafficYn'))),
      kind: cleanText(extractXmlTagValue(itemXml, 'kind')),
      kindDetail: cleanText(extractXmlTagValue(itemXml, 'kindDetail')),
      totalChargers: 0,
      availableCount: 0,
      chargingCount: 0,
      unavailableCount: 0,
      maxOutputKw: null,
      outputValues: new Set<number>(),
      makers: new Set<string>(),
      chargerTypes: new Set<string>(),
      floorLabels: new Set<string>(),
      installedYears: new Set<number>(),
      latestStatusUpdatedAt: null,
      lastChargeStartedAt: null,
      lastChargeEndedAt: null,
      currentChargeStartedAt: null,
    };
    stationMap.set(stationId, aggregate);
  }

  if (!aggregate.address && address) aggregate.address = address;
  if (!aggregate.addressDetail && addressDetail) aggregate.addressDetail = addressDetail;
  if (!aggregate.locationHint && locationHint) aggregate.locationHint = locationHint;
  if (!aggregate.useTime) aggregate.useTime = cleanText(extractXmlTagValue(itemXml, 'useTime'));
  if (!aggregate.agencyName && agencyName) aggregate.agencyName = agencyName;
  if (!aggregate.operatorName && operatorName) aggregate.operatorName = operatorName;
  if (!aggregate.operatorPhone) aggregate.operatorPhone = cleanText(extractXmlTagValue(itemXml, 'busiCall'));
  if (!aggregate.method) aggregate.method = cleanText(extractXmlTagValue(itemXml, 'method'));
  if (aggregate.parkingFree === null) aggregate.parkingFree = toBoolFlag(cleanText(extractXmlTagValue(itemXml, 'parkingFree')));
  if (aggregate.userLimit === null) aggregate.userLimit = toBoolFlag(cleanText(extractXmlTagValue(itemXml, 'limitYn')));
  if (!aggregate.userLimitDetail) aggregate.userLimitDetail = cleanText(extractXmlTagValue(itemXml, 'limitDetail'));
  if (aggregate.trafficSupport === null) aggregate.trafficSupport = toBoolFlag(cleanText(extractXmlTagValue(itemXml, 'trafficYn')));
  if (!aggregate.kind) aggregate.kind = cleanText(extractXmlTagValue(itemXml, 'kind'));
  if (!aggregate.kindDetail) aggregate.kindDetail = cleanText(extractXmlTagValue(itemXml, 'kindDetail'));

  aggregate.totalChargers += 1;

  const statusCode = cleanText(extractXmlTagValue(itemXml, 'stat'));
  if (statusCode === '2') aggregate.availableCount += 1;
  else if (statusCode === '3') aggregate.chargingCount += 1;
  else aggregate.unavailableCount += 1;

  const outputKw = toNumber(cleanText(extractXmlTagValue(itemXml, 'output')));
  if (outputKw !== null) {
    aggregate.outputValues.add(outputKw);
    aggregate.maxOutputKw = aggregate.maxOutputKw === null ? outputKw : Math.max(aggregate.maxOutputKw, outputKw);
  }

  const maker = cleanText(extractXmlTagValue(itemXml, 'maker'));
  if (maker) aggregate.makers.add(maker);

  const chargerType = cleanText(extractXmlTagValue(itemXml, 'chgerType'));
  if (chargerType) aggregate.chargerTypes.add(chargerType);

  const floorType = cleanText(extractXmlTagValue(itemXml, 'floorType'));
  const floorNum = cleanText(extractXmlTagValue(itemXml, 'floorNum'));
  const floorLabel = [floorType, floorNum].filter(Boolean).join(' ').trim();
  if (floorLabel) aggregate.floorLabels.add(floorLabel);

  const installedYear = toPositiveInt(extractXmlTagValue(itemXml, 'year'), 0);
  if (installedYear > 0) aggregate.installedYears.add(installedYear);

  const statUpdatedAtRaw = cleanText(extractXmlTagValue(itemXml, 'statUpdDt'));
  const lastChargeStartedAtRaw = cleanText(extractXmlTagValue(itemXml, 'lastTsdt'));
  const lastChargeEndedAtRaw = cleanText(extractXmlTagValue(itemXml, 'lastTedt'));
  const currentChargeStartedAtRaw = cleanText(extractXmlTagValue(itemXml, 'nowTsdt'));

  aggregate.latestStatusUpdatedAt = maxTimestamp(aggregate.latestStatusUpdatedAt, statUpdatedAtRaw);
  aggregate.lastChargeStartedAt = maxTimestamp(aggregate.lastChargeStartedAt, lastChargeStartedAtRaw);
  aggregate.lastChargeEndedAt = maxTimestamp(aggregate.lastChargeEndedAt, lastChargeEndedAtRaw);
  aggregate.currentChargeStartedAt = maxTimestamp(aggregate.currentChargeStartedAt, currentChargeStartedAtRaw);
}

function toAvailabilityStatus(aggregate: StationAggregate): {
  status: 'available' | 'partial' | 'busy' | 'offline';
  label: string;
} {
  if (aggregate.availableCount > 0 && aggregate.availableCount === aggregate.totalChargers) {
    return { status: 'available', label: '전체 사용 가능' };
  }
  if (aggregate.availableCount > 0) {
    return { status: 'partial', label: '일부 사용 가능' };
  }
  if (aggregate.chargingCount > 0) {
    return { status: 'busy', label: '전부 사용 중' };
  }
  return { status: 'offline', label: '점검 또는 사용 불가' };
}

function toStationFeature(aggregate: StationAggregate): EvChargerFeature {
  const availability = toAvailabilityStatus(aggregate);

  return {
    type: 'Feature',
    id: aggregate.stationId,
    geometry: {
      type: 'Point',
      coordinates: aggregate.coordinates,
    },
    properties: {
      id: aggregate.stationId,
      layerKind: 'infra-ev-charger',
      name: aggregate.name,
      stationId: aggregate.stationId,
      regionCode: aggregate.regionCode,
      regionLabel: aggregate.regionLabel,
      address: combineAddress(aggregate.address, aggregate.addressDetail),
      addressDetail: aggregate.addressDetail,
      locationHint: aggregate.locationHint,
      useTime: aggregate.useTime,
      agencyName: aggregate.agencyName,
      operatorName: aggregate.operatorName,
      operatorPhone: aggregate.operatorPhone,
      chargerMethod: aggregate.method,
      totalChargers: aggregate.totalChargers,
      availableCount: aggregate.availableCount,
      chargingCount: aggregate.chargingCount,
      unavailableCount: aggregate.unavailableCount,
      availabilityStatus: availability.status,
      availabilityLabel: availability.label,
      latestStatusUpdatedAt: formatDateTimeToken(aggregate.latestStatusUpdatedAt),
      lastChargeStartedAt: formatDateTimeToken(aggregate.lastChargeStartedAt),
      lastChargeEndedAt: formatDateTimeToken(aggregate.lastChargeEndedAt),
      currentChargeStartedAt: formatDateTimeToken(aggregate.currentChargeStartedAt),
      maxOutputKw: aggregate.maxOutputKw,
      outputSummary: summarizeNumberSet(aggregate.outputValues, 'kW'),
      makerSummary: summarizeTextSet(aggregate.makers),
      chargerTypeSummary: summarizeTextSet(aggregate.chargerTypes),
      floorSummary: summarizeTextSet(aggregate.floorLabels),
      installedYearSummary: summarizeYearSet(aggregate.installedYears),
      parkingFree: aggregate.parkingFree,
      parkingFreeLabel: aggregate.parkingFree === null ? null : aggregate.parkingFree ? '무료' : '유료 또는 미지원',
      userLimit: aggregate.userLimit,
      userLimitLabel: aggregate.userLimit === null ? null : aggregate.userLimit ? '제한 있음' : '제한 없음',
      userLimitDetail: aggregate.userLimitDetail,
      trafficSupport: aggregate.trafficSupport,
      trafficSupportLabel: aggregate.trafficSupport === null ? null : aggregate.trafficSupport ? '편의 제공' : '편의 정보 없음',
      kind: aggregate.kind,
      kindDetail: aggregate.kindDetail,
      source: 'upstream',
      sourceLabel: '환경부 전기자동차 충전소 정보',
    },
  };
}

function countMatchedStations(
  stationMap: Map<string, StationAggregate>,
  bbox: ReturnType<typeof parseInfraEvChargerBbox>
): number {
  if (!bbox) return stationMap.size;

  let count = 0;
  for (const aggregate of stationMap.values()) {
    if (includesInfraEvChargerCoordinate(bbox, aggregate.coordinates)) {
      count += 1;
    }
  }
  return count;
}

async function loadRegionFeatures(args: {
  apiKey: string;
  upstreamUrl: string;
  regionCode: string;
  pageSize: number;
  bbox: ReturnType<typeof parseInfraEvChargerBbox>;
  candidateTarget: number;
  maxPages: number;
}): Promise<RegionCacheEntry> {
  const cached = regionCache.get(args.regionCode);
  if (cached && Date.now() - cached.fetchedAt < REGION_CACHE_TTL_MS) {
    return cached;
  }

  const warnings: string[] = [];
  const stationMap = new Map<string, StationAggregate>();
  const firstPage = await fetchInfoPage({
    apiKey: args.apiKey,
    upstreamUrl: args.upstreamUrl,
    regionCode: args.regionCode,
    pageNo: 1,
    pageSize: args.pageSize,
  });

  if (firstPage.warning) warnings.push(firstPage.warning);
  for (const itemXml of firstPage.itemXmlList) {
    appendStationItem(itemXml, args.regionCode, stationMap);
  }

  const totalCount = firstPage.totalCount ?? firstPage.itemXmlList.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / args.pageSize));
  const boundedTotalPages = Math.min(totalPages, args.maxPages);
  let fetchedPages = 1;
  let matchedStationCount = countMatchedStations(stationMap, args.bbox);

  for (
    let startPage = 2;
    startPage <= boundedTotalPages && matchedStationCount < args.candidateTarget;
    startPage += PAGE_BATCH_SIZE
  ) {
    const pageNumbers = Array.from(
      { length: Math.min(PAGE_BATCH_SIZE, boundedTotalPages - startPage + 1) },
      (_, index) => startPage + index
    );

    const batch = await Promise.all(pageNumbers.map((pageNo) =>
      fetchInfoPage({
        apiKey: args.apiKey,
        upstreamUrl: args.upstreamUrl,
        regionCode: args.regionCode,
        pageNo,
        pageSize: args.pageSize,
      })
    ));

    fetchedPages += batch.length;
    for (const page of batch) {
      if (page.warning) warnings.push(page.warning);
      for (const itemXml of page.itemXmlList) {
        appendStationItem(itemXml, args.regionCode, stationMap);
      }
    }
    matchedStationCount = countMatchedStations(stationMap, args.bbox);
  }

  const features = [...stationMap.values()]
    .map((aggregate) => toStationFeature(aggregate))
    .sort((left, right) => {
      const availabilityRank = { available: 4, partial: 3, busy: 2, offline: 1 } as const;
      const leftRank = availabilityRank[left.properties.availabilityStatus];
      const rightRank = availabilityRank[right.properties.availabilityStatus];
      if (leftRank !== rightRank) return rightRank - leftRank;
      if (left.properties.availableCount !== right.properties.availableCount) {
        return right.properties.availableCount - left.properties.availableCount;
      }
      if (left.properties.totalChargers !== right.properties.totalChargers) {
        return right.properties.totalChargers - left.properties.totalChargers;
      }
      return left.properties.name.localeCompare(right.properties.name, 'ko');
    });

  const partialFetch = fetchedPages < totalPages;
  if (partialFetch) {
    warnings.push(
      `Limited EV charger page scan for region ${args.regionCode}: ${fetchedPages}/${totalPages} pages`
    );
  }

  const nextCache: RegionCacheEntry = {
    features,
    totalChargers: features.reduce((sum, feature) => sum + feature.properties.totalChargers, 0),
    fetchedPages,
    totalPages,
    partialFetch,
    warnings: Array.from(new Set(warnings)),
    fetchedAt: Date.now(),
  };

  if (!partialFetch && features.length > 0) {
    regionCache.set(args.regionCode, nextCache);
    return nextCache;
  }

  if (cached) {
    return {
      ...cached,
      warnings: Array.from(new Set([
        ...cached.warnings,
        ...warnings,
        `Using stale EV charger cache for region ${args.regionCode}`,
      ])),
    };
  }

  return nextCache;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const bbox = parseInfraEvChargerBbox(requestUrl.searchParams.get('bbox'));
  const featureLimit = clampInfraEvChargerFeatureLimit(
    toPositiveInt(requestUrl.searchParams.get('limit'), DEFAULT_FEATURE_LIMIT)
  );
  const bboxApplied = Boolean(bbox);
  const candidateTarget = buildInfraEvChargerCandidateTarget(featureLimit, bboxApplied);
  const maxPages = clampInfraEvChargerMaxPages(
    toPositiveInt(
      requestUrl.searchParams.get('maxPages'),
      buildInfraEvChargerMaxPages(featureLimit, bboxApplied)
    )
  );
  const pageSize = clampInt(
    toPositiveInt(requestUrl.searchParams.get('numOfRows'), DEFAULT_PAGE_SIZE),
    MIN_PAGE_SIZE,
    MAX_PAGE_SIZE
  );

  const apiKey =
    process.env.TEAM2_INFRA_EV_CHARGER_API_KEY
    ?? process.env.TEAM2_WEATHER_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY
    ?? process.env.TEAM2_DISASTER_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        totalCount: 0,
        matchedCount: 0,
        data: emptyFeatureCollection(),
        warnings: [
          'Missing env: TEAM2_INFRA_EV_CHARGER_API_KEY (or TEAM2_WEATHER_API_KEY / TEAM2_PUBLIC_API_KEY / TEAM2_DISASTER_API_KEY / TEAM2_DISASTER_WILDFIRE_API_KEY)',
        ],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'mock' } }
    );
  }

  const regionCodes = getInfraEvChargerRegionCodesForBbox(bbox);
  const datasets: RegionCacheEntry[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < regionCodes.length; index += REGION_BATCH_SIZE) {
    const batchCodes = regionCodes.slice(index, index + REGION_BATCH_SIZE);
    const batchResults = await Promise.all(batchCodes.map((regionCode) =>
      loadRegionFeatures({
        apiKey,
        upstreamUrl: process.env.TEAM2_INFRA_EV_CHARGER_INFO_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL,
        regionCode,
        pageSize,
        bbox,
        candidateTarget,
        maxPages,
      })
    ));
    datasets.push(...batchResults);
  }

  for (const dataset of datasets) {
    warnings.push(...dataset.warnings);
  }

  const allFeatures = datasets.flatMap((dataset) => dataset.features);
  const matchedFeatures = allFeatures.filter((feature) =>
    includesInfraEvChargerCoordinate(bbox, feature.geometry.coordinates)
  );
  const visibleFeatures = matchedFeatures.slice(0, featureLimit);
  const updatedAt = new Date(
    Math.max(
      0,
      ...datasets.map((dataset) => dataset.fetchedAt)
    )
  ).toISOString();

  const source: 'mock' | 'upstream' = allFeatures.length > 0 ? 'upstream' : 'mock';

  return NextResponse.json(
    {
      source,
      updatedAt,
      totalCount: allFeatures.length,
      matchedCount: matchedFeatures.length,
      data: {
        type: 'FeatureCollection',
        features: visibleFeatures,
      },
      meta: {
        featureLimit,
        featureCount: visibleFeatures.length,
        bboxApplied: Boolean(bbox),
        candidateTarget,
        maxPages,
        regionCodes,
        fetchedPages: datasets.reduce((sum, dataset) => sum + dataset.fetchedPages, 0),
        totalPages: datasets.reduce((sum, dataset) => sum + dataset.totalPages, 0),
        partialFetch: datasets.some((dataset) => dataset.partialFetch),
        totalChargers: datasets.reduce((sum, dataset) => sum + dataset.totalChargers, 0),
      },
      warnings: Array.from(new Set(warnings)),
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': source,
      },
    }
  );
}
