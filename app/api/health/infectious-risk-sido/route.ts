import { NextResponse } from 'next/server';
import { emptyFeatureCollection } from '@/app/api/_shared/geojson-utils';
import {
  clampInt,
  compactText,
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  fetchVWorldFeaturePage,
  type VWorldPageFetchResult,
} from '@/app/api/_shared/vworld-client';
import {
  extractResultWarningFromXml,
  extractXmlItems,
  extractXmlTagValue,
} from '@/app/api/_shared/xml-utils';

const EID_REGION_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/Region';
const VWORLD_DATASET = 'LT_C_ADSIDO_INFO';
const DEFAULT_GEOM_FILTER = 'BOX(124,33,132,39)';
const DEFAULT_REGION_PAGE_SIZE = 200;
const MIN_REGION_PAGE_SIZE = 10;
const MAX_REGION_PAGE_SIZE = 500;
const DEFAULT_REGION_MAX_PAGES = 4;
const MIN_REGION_MAX_PAGES = 1;
const MAX_REGION_MAX_PAGES = 10;
const DEFAULT_VWORLD_PAGE_SIZE = 30;
const DEFAULT_YEAR_LOOKBACK = 6;
const MIN_YEAR_LOOKBACK = 1;
const MAX_YEAR_LOOKBACK = 10;
const DEFAULT_CONCURRENCY = 4;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 8;

type RiskMetric = 'incidence' | 'count';
type SeverityTone = 'info' | 'warning' | 'critical';

interface ProvinceTarget {
  queryCode: string;
  canonicalName: string;
  displayName: string;
}

interface RegionPageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

interface ProvinceDiseaseMetric {
  name: string;
  group: string | null;
  reportedCases: number;
  incidencePer100k: number;
}

interface ProvinceAggregate {
  canonicalName: string;
  displayName: string;
  yearLabel: string;
  reportedCases: number;
  incidencePer100k: number;
  diseaseCount: number;
  topDiseaseName: string | null;
  topDiseaseGroup: string | null;
  topDiseaseReportedCases: number | null;
  topDiseaseIncidencePer100k: number | null;
}

interface DiseaseOption {
  value: string;
  label: string;
  group: string | null;
}

interface RiskStyle {
  fillColor: [number, number, number, number];
  lineColor: [number, number, number, number];
  severity: SeverityTone;
  riskLabel: string;
  relativeRiskIndex: number;
}

const EID_PROVINCES: ProvinceTarget[] = [
  { queryCode: '01', canonicalName: '서울', displayName: '서울특별시' },
  { queryCode: '02', canonicalName: '부산', displayName: '부산광역시' },
  { queryCode: '03', canonicalName: '대구', displayName: '대구광역시' },
  { queryCode: '04', canonicalName: '인천', displayName: '인천광역시' },
  { queryCode: '05', canonicalName: '광주', displayName: '광주광역시' },
  { queryCode: '06', canonicalName: '대전', displayName: '대전광역시' },
  { queryCode: '07', canonicalName: '울산', displayName: '울산광역시' },
  { queryCode: '08', canonicalName: '경기', displayName: '경기도' },
  { queryCode: '09', canonicalName: '강원', displayName: '강원특별자치도' },
  { queryCode: '10', canonicalName: '충북', displayName: '충청북도' },
  { queryCode: '11', canonicalName: '충남', displayName: '충청남도' },
  { queryCode: '12', canonicalName: '전북', displayName: '전북특별자치도' },
  { queryCode: '13', canonicalName: '전남', displayName: '전라남도' },
  { queryCode: '14', canonicalName: '경북', displayName: '경상북도' },
  { queryCode: '15', canonicalName: '경남', displayName: '경상남도' },
  { queryCode: '16', canonicalName: '제주', displayName: '제주특별자치도' },
  { queryCode: '17', canonicalName: '세종', displayName: '세종특별자치시' },
];

const PROVINCE_NAME_ALIASES = new Map<string, string>([
  ['서울', '서울'],
  ['서울특별시', '서울'],
  ['부산', '부산'],
  ['부산광역시', '부산'],
  ['대구', '대구'],
  ['대구광역시', '대구'],
  ['인천', '인천'],
  ['인천광역시', '인천'],
  ['광주', '광주'],
  ['광주광역시', '광주'],
  ['대전', '대전'],
  ['대전광역시', '대전'],
  ['울산', '울산'],
  ['울산광역시', '울산'],
  ['경기', '경기'],
  ['경기도', '경기'],
  ['강원', '강원'],
  ['강원도', '강원'],
  ['강원특별자치도', '강원'],
  ['충북', '충북'],
  ['충청북도', '충북'],
  ['충남', '충남'],
  ['충청남도', '충남'],
  ['전북', '전북'],
  ['전라북도', '전북'],
  ['전북특별자치도', '전북'],
  ['전남', '전남'],
  ['전라남도', '전남'],
  ['경북', '경북'],
  ['경상북도', '경북'],
  ['경남', '경남'],
  ['경상남도', '경남'],
  ['제주', '제주'],
  ['제주도', '제주'],
  ['제주특별자치도', '제주'],
  ['세종', '세종'],
  ['세종특별자치시', '세종'],
]);

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compactProvinceKey(value: string): string {
  return compactText(value).replace(/\s+/g, '');
}

function normalizeProvinceName(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = compactProvinceKey(value);
  for (const [alias, canonical] of PROVINCE_NAME_ALIASES.entries()) {
    if (compactProvinceKey(alias) === compact) return canonical;
  }
  return null;
}

function normalizeVWorldDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function parseRequestedMetric(value: string | null): RiskMetric {
  return value === 'count' ? 'count' : 'incidence';
}

function parseRequestedYear(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function parseRequestedDisease(value: string | null): string | null {
  if (!value) return null;
  const normalized = compactText(value);
  return normalized || null;
}

function extractRowsFromXml(xml: string): JsonRecord[] {
  const matches = extractXmlItems(xml, 'item');
  const rows: JsonRecord[] = [];
  for (const itemXml of matches) {
    rows.push({
      year: extractXmlTagValue(itemXml, 'year'),
      sidoCd: extractXmlTagValue(itemXml, 'sidoCd'),
      sidoNm: extractXmlTagValue(itemXml, 'sidoNm'),
      icdGroupNm: extractXmlTagValue(itemXml, 'icdGroupNm'),
      icdNm: extractXmlTagValue(itemXml, 'icdNm'),
      resultVal: extractXmlTagValue(itemXml, 'resultVal'),
    });
  }
  return rows;
}

function interpolateColor(
  start: [number, number, number, number],
  end: [number, number, number, number],
  t: number
): [number, number, number, number] {
  return [
    Math.round(start[0] + (end[0] - start[0]) * t),
    Math.round(start[1] + (end[1] - start[1]) * t),
    Math.round(start[2] + (end[2] - start[2]) * t),
    Math.round(start[3] + (end[3] - start[3]) * t),
  ];
}

function getRiskStyle(value: number, min: number, max: number): RiskStyle {
  const normalized = max <= 0
    ? 0
    : max === min
      ? 1
      : Math.min(1, Math.max(0, (value - min) / (max - min)));

  const low: [number, number, number, number] = [52, 211, 153, 78];
  const mid: [number, number, number, number] = [251, 191, 36, 132];
  const high: [number, number, number, number] = [239, 68, 68, 182];

  const fillColor = normalized < 0.5
    ? interpolateColor(low, mid, normalized / 0.5)
    : interpolateColor(mid, high, (normalized - 0.5) / 0.5);
  const lineColor = [
    Math.max(0, Math.round(fillColor[0] * 0.82)),
    Math.max(0, Math.round(fillColor[1] * 0.8)),
    Math.max(0, Math.round(fillColor[2] * 0.8)),
    230,
  ] satisfies [number, number, number, number];

  if (normalized >= 0.75) {
    return {
      fillColor,
      lineColor,
      severity: 'critical',
      riskLabel: '높음',
      relativeRiskIndex: Math.round(normalized * 100),
    };
  }

  if (normalized >= 0.4) {
    return {
      fillColor,
      lineColor,
      severity: 'warning',
      riskLabel: '주의',
      relativeRiskIndex: Math.round(normalized * 100),
    };
  }

  return {
    fillColor,
    lineColor,
    severity: 'info',
    riskLabel: '낮음',
    relativeRiskIndex: Math.round(normalized * 100),
  };
}

function getNoDataRiskStyle(): RiskStyle {
  return {
    fillColor: [100, 116, 139, 54],
    lineColor: [100, 116, 139, 155],
    severity: 'info',
    riskLabel: '현재 정보 없음',
    relativeRiskIndex: 0,
  };
}

async function fetchRegionPage(args: {
  apiKey: string;
  searchType: '1' | '2';
  year: number;
  sidoCode: string;
  pageNo: number;
  pageSize: number;
}): Promise<RegionPageFetchResult> {
  const url = new URL(EID_REGION_ENDPOINT);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('resType', '2');
  url.searchParams.set('searchType', args.searchType);
  url.searchParams.set('searchYear', String(args.year));
  url.searchParams.set('searchSidoCd', args.sidoCode);
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, application/xml;q=0.8, */*;q=0.7',
    },
  });

  if (!response.ok) {
    return {
      rows: [],
      totalCount: null,
      warning: `KDCA infectious region upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: 'KDCA infectious region upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    const warning = extractResultWarningFromCommonJson(json, 'KDCA infectious region API') ?? undefined;
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json),
      warning,
    };
  } catch {
    const warning = extractResultWarningFromXml(text, {
      sourceLabel: 'KDCA infectious region API',
      decodeEntities: true,
      compactWhitespace: true,
    }) ?? undefined;

    return {
      rows: extractRowsFromXml(text),
      totalCount: toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null,
      warning,
    };
  }
}

async function fetchRegionRows(args: {
  apiKey: string;
  searchType: '1' | '2';
  year: number;
  province: ProvinceTarget;
  pageSize: number;
  maxPages: number;
}): Promise<{ rows: JsonRecord[]; warnings: string[] }> {
  const warnings: string[] = [];
  const rows: JsonRecord[] = [];

  let totalPages = 1;
  for (let pageNo = 1; pageNo <= totalPages && pageNo <= args.maxPages; pageNo += 1) {
    const pageResult = await fetchRegionPage({
      apiKey: args.apiKey,
      searchType: args.searchType,
      year: args.year,
      sidoCode: args.province.queryCode,
      pageNo,
      pageSize: args.pageSize,
    });

    if (pageResult.warning) warnings.push(pageResult.warning);
    rows.push(...pageResult.rows);

    if (pageResult.totalCount && pageResult.totalCount > 0) {
      totalPages = Math.max(1, Math.ceil(pageResult.totalCount / args.pageSize));
    } else if (pageResult.rows.length < args.pageSize) {
      break;
    }
  }

  return { rows, warnings };
}

function extractLocalProvinceRows(rows: JsonRecord[], canonicalName: string): JsonRecord[] {
  return rows.filter((row) => normalizeProvinceName(pickString(row, ['sidoNm'])) === canonicalName);
}

async function collectProvinceAggregate(args: {
  apiKey: string;
  province: ProvinceTarget;
  year: number;
  pageSize: number;
  maxPages: number;
  selectedDisease: string | null;
}): Promise<{ aggregate: ProvinceAggregate | null; warnings: string[]; diseaseOptions: DiseaseOption[] }> {
  const [countResult, incidenceResult] = await Promise.all([
    fetchRegionRows({
      apiKey: args.apiKey,
      searchType: '1',
      year: args.year,
      province: args.province,
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    }),
    fetchRegionRows({
      apiKey: args.apiKey,
      searchType: '2',
      year: args.year,
      province: args.province,
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    }),
  ]);

  const localCountRows = extractLocalProvinceRows(countResult.rows, args.province.canonicalName);
  const localIncidenceRows = extractLocalProvinceRows(incidenceResult.rows, args.province.canonicalName);

  if (localCountRows.length === 0 && localIncidenceRows.length === 0) {
    return {
      aggregate: null,
      warnings: [...countResult.warnings, ...incidenceResult.warnings],
      diseaseOptions: [],
    };
  }

  const diseaseMetrics = new Map<string, ProvinceDiseaseMetric>();
  const diseaseOptionMap = new Map<string, DiseaseOption>();
  const yearLabel =
    pickString(localCountRows[0] ?? localIncidenceRows[0] ?? {}, ['year'])
    ?? `${args.year}년`;

  for (const row of localCountRows) {
    const diseaseName = pickString(row, ['icdNm']);
    if (!diseaseName) continue;
    diseaseOptionMap.set(diseaseName, {
      value: diseaseName,
      label: diseaseName,
      group: pickString(row, ['icdGroupNm']),
    });
    if (args.selectedDisease && diseaseName !== args.selectedDisease) continue;
    const entry = diseaseMetrics.get(diseaseName) ?? {
      name: diseaseName,
      group: pickString(row, ['icdGroupNm']),
      reportedCases: 0,
      incidencePer100k: 0,
    };
    entry.reportedCases += pickNumber(row, ['resultVal']) ?? 0;
    if (!entry.group) {
      entry.group = pickString(row, ['icdGroupNm']);
    }
    diseaseMetrics.set(diseaseName, entry);
  }

  for (const row of localIncidenceRows) {
    const diseaseName = pickString(row, ['icdNm']);
    if (!diseaseName) continue;
    diseaseOptionMap.set(diseaseName, {
      value: diseaseName,
      label: diseaseName,
      group: pickString(row, ['icdGroupNm']),
    });
    if (args.selectedDisease && diseaseName !== args.selectedDisease) continue;
    const entry = diseaseMetrics.get(diseaseName) ?? {
      name: diseaseName,
      group: pickString(row, ['icdGroupNm']),
      reportedCases: 0,
      incidencePer100k: 0,
    };
    entry.incidencePer100k += pickNumber(row, ['resultVal']) ?? 0;
    if (!entry.group) {
      entry.group = pickString(row, ['icdGroupNm']);
    }
    diseaseMetrics.set(diseaseName, entry);
  }

  const metrics = [...diseaseMetrics.values()];
  if (metrics.length === 0) {
    return {
      aggregate: {
        canonicalName: args.province.canonicalName,
        displayName: args.province.displayName,
        yearLabel,
        reportedCases: 0,
        incidencePer100k: 0,
        diseaseCount: args.selectedDisease ? 1 : 0,
        topDiseaseName: args.selectedDisease,
        topDiseaseGroup: diseaseOptionMap.get(args.selectedDisease ?? '')?.group ?? null,
        topDiseaseReportedCases: 0,
        topDiseaseIncidencePer100k: 0,
      },
      warnings: [...countResult.warnings, ...incidenceResult.warnings],
      diseaseOptions: [...diseaseOptionMap.values()],
    };
  }
  const topDisease = metrics
    .slice()
    .sort((a, b) => (
      b.incidencePer100k - a.incidencePer100k
      || b.reportedCases - a.reportedCases
      || a.name.localeCompare(b.name, 'ko-KR')
    ))[0] ?? null;

  return {
    aggregate: {
      canonicalName: args.province.canonicalName,
      displayName: args.province.displayName,
      yearLabel,
      reportedCases: Math.round(metrics.reduce((sum, item) => sum + item.reportedCases, 0)),
      incidencePer100k: roundTo(metrics.reduce((sum, item) => sum + item.incidencePer100k, 0), 2),
      diseaseCount: metrics.length,
      topDiseaseName: topDisease?.name ?? null,
      topDiseaseGroup: topDisease?.group ?? null,
      topDiseaseReportedCases: topDisease ? Math.round(topDisease.reportedCases) : null,
      topDiseaseIncidencePer100k: topDisease ? roundTo(topDisease.incidencePer100k, 2) : null,
    },
    warnings: [...countResult.warnings, ...incidenceResult.warnings],
    diseaseOptions: [...diseaseOptionMap.values()],
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) return;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
}

async function resolveTargetYear(args: {
  apiKey: string;
  explicitYear: number | null;
  maxLookbackYears: number;
}): Promise<{ year: number; warnings: string[] }> {
  if (args.explicitYear) {
    return { year: args.explicitYear, warnings: [] };
  }

  const currentYear = new Date().getFullYear();
  for (let offset = 0; offset <= args.maxLookbackYears; offset += 1) {
    const candidateYear = currentYear - offset;
    const probe = await fetchRegionRows({
      apiKey: args.apiKey,
      searchType: '2',
      year: candidateYear,
      province: EID_PROVINCES[0],
      pageSize: 5,
      maxPages: 1,
    });

    const localRows = extractLocalProvinceRows(probe.rows, EID_PROVINCES[0].canonicalName);
    if (localRows.length > 0) {
      return {
        year: candidateYear,
        warnings: candidateYear === currentYear
          ? probe.warnings
          : [
              ...probe.warnings,
              `KDCA infectious region data unavailable for ${currentYear}, using latest available year ${candidateYear}`,
            ],
      };
    }
  }

  return {
    year: currentYear,
    warnings: [`KDCA infectious region data unavailable for ${currentYear} and prior ${args.maxLookbackYears} years`],
  };
}

async function fetchAvailableYears(args: {
  apiKey: string;
  maxLookbackYears: number;
}): Promise<{ years: number[]; warnings: string[] }> {
  const currentYear = new Date().getFullYear();
  const warnings: string[] = [];
  const years: number[] = [];

  for (let offset = 0; offset <= args.maxLookbackYears; offset += 1) {
    const candidateYear = currentYear - offset;
    const probe = await fetchRegionRows({
      apiKey: args.apiKey,
      searchType: '2',
      year: candidateYear,
      province: EID_PROVINCES[0],
      pageSize: 5,
      maxPages: 1,
    });

    warnings.push(...probe.warnings);

    const localRows = extractLocalProvinceRows(probe.rows, EID_PROVINCES[0].canonicalName);
    if (localRows.length > 0) {
      years.push(candidateYear);
    }
  }

  return {
    years,
    warnings: dedupeWarnings(warnings),
  };
}

function sanitizeProvinceFeature(feature: GeoJSON.Feature, index: number): GeoJSON.Feature {
  const properties = (feature.properties as JsonRecord | null) ?? {};
  const provinceName = pickString(properties, ['ctp_kor_nm']) ?? `광역시도 ${index + 1}`;
  const canonicalName = normalizeProvinceName(provinceName);
  const featureId = canonicalName
    ? `health-infectious-risk-sido-${canonicalName}`
    : `health-infectious-risk-sido-${index + 1}`;

  return {
    ...feature,
    id: featureId,
    properties: {
      ...properties,
      provinceName,
      canonicalProvinceName: canonicalName,
    },
  };
}

async function fetchProvincePolygonPage(args: {
  key: string;
  domain?: string;
  page: number;
  pageSize: number;
  geomFilter: string;
}): Promise<VWorldPageFetchResult> {
  return fetchVWorldFeaturePage({
    warningLabel: 'VWorld province polygons',
    dataset: VWORLD_DATASET,
    key: args.key,
    domain: args.domain,
    page: args.page,
    pageSize: args.pageSize,
    geomFilter: args.geomFilter,
    sanitizeFeature: sanitizeProvinceFeature,
  });
}

async function fetchProvincePolygons(args: {
  key: string;
  domain?: string;
  geomFilter: string;
  pageSize: number;
}): Promise<{ features: GeoJSON.Feature[]; warnings: string[] }> {
  const warnings: string[] = [];
  const features: GeoJSON.Feature[] = [];

  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const pageResult = await fetchProvincePolygonPage({
      key: args.key,
      domain: args.domain,
      page,
      pageSize: args.pageSize,
      geomFilter: args.geomFilter,
    });

    if (pageResult.warning) warnings.push(pageResult.warning);
    totalPages = pageResult.totalPages;
    features.push(...pageResult.features);
  }

  return { features, warnings };
}

function dedupeWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))];
}

function toRiskFeatures(args: {
  polygonFeatures: GeoJSON.Feature[];
  aggregates: ProvinceAggregate[];
  metric: RiskMetric;
  updatedAt: string;
  selectedDisease: string | null;
}): GeoJSON.Feature[] {
  const aggregateMap = new Map(args.aggregates.map((aggregate) => [aggregate.canonicalName, aggregate]));
  const availableValues = args.aggregates
    .map((aggregate) => args.metric === 'count' ? aggregate.reportedCases : aggregate.incidencePer100k)
    .filter((value) => Number.isFinite(value));
  const minValue = availableValues.length > 0 ? Math.min(...availableValues) : 0;
  const maxValue = availableValues.length > 0 ? Math.max(...availableValues) : 0;
  const ranked = args.aggregates
    .slice()
    .sort((a, b) => (
      (args.metric === 'count' ? b.reportedCases - a.reportedCases : b.incidencePer100k - a.incidencePer100k)
      || a.displayName.localeCompare(b.displayName, 'ko-KR')
    ));
  const rankMap = new Map(ranked.map((aggregate, index) => [aggregate.canonicalName, index + 1]));

  return args.polygonFeatures.map((feature, index) => {
    const properties = (feature.properties as JsonRecord | null) ?? {};
    const provinceName = pickString(properties, ['ctp_kor_nm', 'provinceName']) ?? `광역시도 ${index + 1}`;
    const canonicalName = normalizeProvinceName(pickString(properties, ['canonicalProvinceName', 'ctp_kor_nm', 'provinceName']));
    const aggregate = canonicalName ? aggregateMap.get(canonicalName) ?? null : null;
    const riskValue = aggregate
      ? (args.metric === 'count' ? aggregate.reportedCases : aggregate.incidencePer100k)
      : null;
    const riskStyle = aggregate ? getRiskStyle(riskValue ?? 0, minValue, maxValue) : getNoDataRiskStyle();
    const fullName = aggregate?.displayName ?? provinceName;
    const featureId = canonicalName
      ? `health-infectious-risk-sido-${canonicalName}`
      : `health-infectious-risk-sido-${index + 1}`;

    return {
      ...feature,
      id: featureId,
      properties: {
        ...properties,
        id: featureId,
        name: fullName,
        shortName: canonicalName ?? provinceName,
        layerId: 'health-infectious-risk-sido',
        layerKind: 'infectious-risk-sido',
        riskMetric: args.metric,
        riskMetricLabel: args.metric === 'count'
          ? '전수신고 감염병 발생 건수'
          : '인구 10만명당 전수신고 감염병 발생률',
        selectedDisease: args.selectedDisease,
        selectedDiseaseLabel: args.selectedDisease ?? '전체 감염병',
        riskValue: aggregate
          ? (args.metric === 'count' ? aggregate.reportedCases : aggregate.incidencePer100k)
          : null,
        reportedCases: aggregate?.reportedCases ?? null,
        incidencePer100k: aggregate?.incidencePer100k ?? null,
        diseaseCount: aggregate?.diseaseCount ?? null,
        topDiseaseName: aggregate?.topDiseaseName ?? null,
        topDiseaseGroup: aggregate?.topDiseaseGroup ?? null,
        topDiseaseReportedCases: aggregate?.topDiseaseReportedCases ?? null,
        topDiseaseIncidencePer100k: aggregate?.topDiseaseIncidencePer100k ?? null,
        provinceRank: canonicalName ? rankMap.get(canonicalName) ?? null : null,
        provinceTotal: ranked.length,
        year: aggregate?.yearLabel ?? null,
        severity: riskStyle.severity,
        riskLabel: riskStyle.riskLabel,
        relativeRiskIndex: riskStyle.relativeRiskIndex,
        fillColor: riskStyle.fillColor,
        lineColor: riskStyle.lineColor,
        source: 'kdca-eid-vworld',
        sourceLabel: '질병관리청 전수신고 감염병 발생현황 + VWorld 광역시도 경계',
        updatedAt: args.updatedAt,
        dataAvailable: Boolean(aggregate),
        aggregationScope: args.selectedDisease ? 'single-disease' : 'all-notifiable-diseases',
        aggregationLabel: args.selectedDisease ? `${args.selectedDisease} 단일 감염병` : '전수신고 감염병 전체 합산',
      },
    };
  });
}

export async function GET(request: Request) {
  const apiKey =
    process.env.TEAM2_HEALTH_INFECTIOUS_RISK_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;
  const vworldKey = process.env.TEAM2_DIGITAL_TWIN_API_KEY;

  if (!apiKey || !vworldKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: dedupeWarnings([
          !apiKey ? 'Missing env: TEAM2_HEALTH_INFECTIOUS_RISK_API_KEY (or TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_HEALTH_API_KEY / TEAM2_PUBLIC_API_KEY)' : '',
          !vworldKey ? 'Missing env: TEAM2_DIGITAL_TWIN_API_KEY' : '',
        ]),
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const searchParams = new URL(request.url).searchParams;
  const explicitYear = parseRequestedYear(searchParams.get('year'));
  const metric = parseRequestedMetric(searchParams.get('metric'));
  const selectedDisease = parseRequestedDisease(searchParams.get('disease'));
  const regionPageSize = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_RISK_REGION_PAGE_SIZE, DEFAULT_REGION_PAGE_SIZE),
    MIN_REGION_PAGE_SIZE,
    MAX_REGION_PAGE_SIZE
  );
  const regionMaxPages = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_RISK_REGION_MAX_PAGES, DEFAULT_REGION_MAX_PAGES),
    MIN_REGION_MAX_PAGES,
    MAX_REGION_MAX_PAGES
  );
  const yearLookback = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_RISK_MAX_LOOKBACK_YEARS, DEFAULT_YEAR_LOOKBACK),
    MIN_YEAR_LOOKBACK,
    MAX_YEAR_LOOKBACK
  );
  const concurrency = clampInt(
    toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_RISK_CONCURRENCY, DEFAULT_CONCURRENCY),
    MIN_CONCURRENCY,
    MAX_CONCURRENCY
  );
  const geomFilter = process.env.TEAM2_HEALTH_INFECTIOUS_RISK_GEOM_FILTER ?? DEFAULT_GEOM_FILTER;
  const vworldDomain = normalizeVWorldDomain(process.env.TEAM2_DIGITAL_TWIN_API_DOMAIN);
  const warnings: string[] = [];
  const availableYearsResult = await fetchAvailableYears({
    apiKey,
    maxLookbackYears: yearLookback,
  });
  warnings.push(...availableYearsResult.warnings);

  const targetYearResult = await resolveTargetYear({
    apiKey,
    explicitYear,
    maxLookbackYears: yearLookback,
  });
  warnings.push(...targetYearResult.warnings);

  const provinceResults = await mapWithConcurrency(EID_PROVINCES, concurrency, async (province) => {
    return collectProvinceAggregate({
      apiKey,
      province,
      year: targetYearResult.year,
      pageSize: regionPageSize,
      maxPages: regionMaxPages,
      selectedDisease,
    });
  });

  const diseaseOptionMap = new Map<string, DiseaseOption>();
  const aggregates = provinceResults
    .map((result) => {
      warnings.push(...result.warnings);
      for (const option of result.diseaseOptions) {
        diseaseOptionMap.set(option.value, option);
      }
      return result.aggregate;
    })
    .filter((aggregate): aggregate is ProvinceAggregate => Boolean(aggregate));

  if (aggregates.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: dedupeWarnings(
          warnings.length > 0
            ? warnings
            : [`KDCA infectious region upstream returned no province aggregates for ${targetYearResult.year}`]
        ),
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const polygonResult = await fetchProvincePolygons({
    key: vworldKey,
    domain: vworldDomain,
    geomFilter,
    pageSize: DEFAULT_VWORLD_PAGE_SIZE,
  });
  warnings.push(...polygonResult.warnings);

  if (polygonResult.features.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: emptyFeatureCollection(),
        warnings: dedupeWarnings(
          warnings.length > 0
            ? warnings
            : ['VWorld province polygons returned no features']
        ),
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const updatedAt = new Date().toISOString();
  const diseaseOptions = [...diseaseOptionMap.values()].sort((a, b) => (
    (a.group ?? '').localeCompare(b.group ?? '', 'ko-KR')
    || a.label.localeCompare(b.label, 'ko-KR')
  ));
  const features = toRiskFeatures({
    polygonFeatures: polygonResult.features,
    aggregates,
    metric,
    updatedAt,
    selectedDisease,
  });

  return NextResponse.json(
    {
      source: 'upstream',
      updatedAt,
      filters: {
        availableYears: availableYearsResult.years.length > 0 ? availableYearsResult.years : [targetYearResult.year],
        selectedYear: targetYearResult.year,
        selectedMetric: metric,
        selectedDisease,
        diseaseOptions,
      },
      data: {
        type: 'FeatureCollection',
        features,
      } satisfies GeoJSON.FeatureCollection,
      warnings: dedupeWarnings(warnings),
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': 'upstream',
      },
    }
  );
}
