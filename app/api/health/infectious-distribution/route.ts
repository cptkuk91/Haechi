import { NextResponse } from 'next/server';
import {
  compactText,
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  extractTotalCountFromCommonJson,
  pickString,
  toNumber,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import {
  extractResultWarningFromXml,
  extractXmlItems,
  extractXmlTagValue,
} from '@/app/api/_shared/xml-utils';

const DISEASE_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/Disease';
const AGE_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/Age';
const GENDER_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/Gender';
const DEATH_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/death';
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_AVAILABLE_YEAR_RANGE = 6;
const SOURCE_LABEL = '질병관리청 전수신고 감염병 발생현황';

export const runtime = 'nodejs';

type Metric = 'count' | 'incidence';
type EndpointKind = 'disease' | 'age' | 'gender' | 'death';

interface DiseaseOption {
  value: string;
  label: string;
  group: string | null;
}

interface DistributionRow {
  label: string;
  value: number;
  barPct: number;
  group: string | null;
}

interface DistributionSummary {
  diseaseCount: number;
  topDiseaseName: string | null;
  topDiseaseValue: number | null;
  selectedDiseaseName: string | null;
  selectedDiseaseValue: number | null;
  peakAgeLabel: string | null;
  peakAgeValue: number | null;
  peakGenderLabel: string | null;
  peakGenderValue: number | null;
  deathTotal: number | null;
  deathTopDiseaseName: string | null;
  deathTopDiseaseValue: number | null;
}

interface EndpointRowsResult {
  rows: JsonRecord[];
  warnings: string[];
}

interface PageFetchResult {
  rows: JsonRecord[];
  totalCount: number | null;
  warning?: string;
}

interface BaseAggregatedRow {
  label: string;
  value: number;
  group: string | null;
}

function getCurrentYear(): number {
  return new Date().getFullYear();
}

function buildAvailableYears(): number[] {
  const currentYear = getCurrentYear();
  return Array.from({ length: DEFAULT_AVAILABLE_YEAR_RANGE + 1 }, (_value, index) => currentYear - index);
}

function parseRequestedYear(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < 2000 || parsed > 2100) return fallback;
  return parsed;
}

function parseRequestedMetric(value: string | null): Metric {
  return value === 'incidence' ? 'incidence' : 'count';
}

function parseRequestedDisease(value: string | null): string | null {
  if (!value) return null;
  const normalized = compactText(value);
  return normalized || null;
}

function getMetricSearchType(metric: Metric): '1' | '2' {
  return metric === 'incidence' ? '2' : '1';
}

function getMetricLabel(metric: Metric): string {
  return metric === 'incidence' ? '10만명당 발생률' : '발생건수';
}

function parseNumericValue(value: unknown): number {
  const parsed = toNumber(value);
  return parsed === null ? 0 : parsed;
}

function extractDistributionRowsFromXml(xml: string, kind: EndpointKind): JsonRecord[] {
  const items = extractXmlItems(xml, 'item');
  return items.map((itemXml) => ({
    year: extractXmlTagValue(itemXml, 'year'),
    icdGroupNm: extractXmlTagValue(itemXml, 'icdGroupNm'),
    icdNm: extractXmlTagValue(itemXml, 'icdNm'),
    resultVal: extractXmlTagValue(itemXml, 'resultVal'),
    ...(kind === 'disease'
      ? { patntType: extractXmlTagValue(itemXml, 'patntType') }
      : {}),
    ...(kind === 'age'
      ? { ageRange: extractXmlTagValue(itemXml, 'ageRange') }
      : {}),
    ...(kind === 'gender'
      ? { sex: extractXmlTagValue(itemXml, 'sex') }
      : {}),
  }));
}

async function fetchDistributionPage(args: {
  endpoint: string;
  endpointLabel: string;
  kind: EndpointKind;
  apiKey: string;
  metric: Metric;
  year: number;
  pageNo: number;
  pageSize: number;
}): Promise<PageFetchResult> {
  const url = new URL(args.endpoint);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('resType', '2');
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));

  if (args.kind === 'death') {
    url.searchParams.set('searchStartYear', String(args.year));
    url.searchParams.set('searchEndYear', String(args.year));
  } else {
    url.searchParams.set('searchType', getMetricSearchType(args.metric));
    url.searchParams.set('searchYear', String(args.year));
    if (args.kind === 'disease') {
      url.searchParams.set('patntType', '1');
    }
  }

  const response = await fetch(url.toString(), {
    cache: 'no-store',
    headers: {
      Accept: 'application/json, application/xml;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      rows: [],
      totalCount: null,
      warning: `${args.endpointLabel} responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      rows: [],
      totalCount: null,
      warning: `${args.endpointLabel} returned empty body`,
    };
  }

  try {
    const json = JSON.parse(text);
    return {
      rows: extractRowsFromCommonJson(json),
      totalCount: extractTotalCountFromCommonJson(json),
      warning: extractResultWarningFromCommonJson(json, args.endpointLabel) ?? undefined,
    };
  } catch {
    return {
      rows: extractDistributionRowsFromXml(text, args.kind),
      totalCount: toPositiveInt(extractXmlTagValue(text, 'totalCount'), 0) || null,
      warning: extractResultWarningFromXml(text, { sourceLabel: args.endpointLabel }) ?? undefined,
    };
  }
}

async function fetchEndpointRows(args: {
  endpoint: string;
  endpointLabel: string;
  kind: EndpointKind;
  apiKey: string;
  metric: Metric;
  year: number;
  pageSize: number;
  maxPages: number;
}): Promise<EndpointRowsResult> {
  const warnings: string[] = [];
  const firstPage = await fetchDistributionPage({
    ...args,
    pageNo: 1,
  });

  if (firstPage.warning) {
    warnings.push(firstPage.warning);
  }

  const rows = [...firstPage.rows];
  const totalCount = firstPage.totalCount ?? firstPage.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / args.pageSize));
  const cappedPages = Math.min(totalPages, args.maxPages);

  for (let pageNo = 2; pageNo <= cappedPages; pageNo += 1) {
    const page = await fetchDistributionPage({
      ...args,
      pageNo,
    });
    if (page.warning) {
      warnings.push(page.warning);
    }
    rows.push(...page.rows);
  }

  if (totalPages > args.maxPages) {
    warnings.push(`${args.endpointLabel} pages truncated at ${args.maxPages}/${totalPages}`);
  }

  return { rows, warnings };
}

function sortByValueDesc(a: BaseAggregatedRow, b: BaseAggregatedRow): number {
  if (a.value !== b.value) return b.value - a.value;
  return a.label.localeCompare(b.label, 'ko-KR');
}

function toDistributionRows(rows: BaseAggregatedRow[]): DistributionRow[] {
  const maxValue = rows.reduce((acc, row) => Math.max(acc, row.value), 0);
  return rows.map((row) => ({
    label: row.label,
    value: row.value,
    barPct: maxValue > 0 ? Number(((row.value / maxValue) * 100).toFixed(1)) : 0,
    group: row.group,
  }));
}

function buildDiseaseRows(rows: JsonRecord[]): BaseAggregatedRow[] {
  const aggregated = new Map<string, BaseAggregatedRow>();

  for (const row of rows) {
    const label = pickString(row, ['icdNm']);
    if (!label || label === '계') continue;
    const value = parseNumericValue(row.resultVal);
    const group = pickString(row, ['icdGroupNm']);
    const existing = aggregated.get(label);
    if (existing) {
      existing.value += value;
      if (!existing.group && group) existing.group = group;
      continue;
    }
    aggregated.set(label, { label, value, group });
  }

  return [...aggregated.values()].sort(sortByValueDesc);
}

function buildDiseaseOptions(rows: BaseAggregatedRow[]): DiseaseOption[] {
  return rows.map((row) => ({
    value: row.label,
    label: row.label,
    group: row.group,
  }));
}

function resolveSelectedDisease(requestedDisease: string | null, diseaseOptions: DiseaseOption[]): string | null {
  if (requestedDisease && diseaseOptions.some((option) => option.value === requestedDisease)) {
    return requestedDisease;
  }
  return diseaseOptions[0]?.value ?? null;
}

function parseAgeSortKey(label: string): number {
  const normalized = compactText(label);
  if (normalized === '계') return Number.MAX_SAFE_INTEGER;
  const numbers = normalized.match(/\d+/g);
  if (!numbers?.length) return Number.MAX_SAFE_INTEGER - 1;
  return Number(numbers[0]);
}

function buildAgeRows(rows: JsonRecord[], selectedDisease: string | null): BaseAggregatedRow[] {
  if (!selectedDisease) return [];

  const aggregated = new Map<string, BaseAggregatedRow>();

  for (const row of rows) {
    const diseaseLabel = pickString(row, ['icdNm']);
    if (diseaseLabel !== selectedDisease) continue;
    const ageRange = pickString(row, ['ageRange']);
    if (!ageRange || ageRange === '계') continue;
    const value = parseNumericValue(row.resultVal);
    if (value <= 0) continue;
    const existing = aggregated.get(ageRange);
    if (existing) {
      existing.value += value;
      continue;
    }
    aggregated.set(ageRange, { label: ageRange, value, group: null });
  }

  return [...aggregated.values()].sort((a, b) => {
    if (a.value !== b.value) return b.value - a.value;
    return parseAgeSortKey(a.label) - parseAgeSortKey(b.label);
  });
}

function getGenderSortKey(label: string): number {
  if (label === '남') return 1;
  if (label === '여') return 2;
  if (label === '계') return 0;
  return 10;
}

function buildGenderRows(rows: JsonRecord[], selectedDisease: string | null): BaseAggregatedRow[] {
  if (!selectedDisease) return [];

  const aggregated = new Map<string, BaseAggregatedRow>();

  for (const row of rows) {
    const diseaseLabel = pickString(row, ['icdNm']);
    if (diseaseLabel !== selectedDisease) continue;
    const sex = pickString(row, ['sex']);
    if (!sex || sex === '계') continue;
    const value = parseNumericValue(row.resultVal);
    const existing = aggregated.get(sex);
    if (existing) {
      existing.value += value;
      continue;
    }
    aggregated.set(sex, { label: sex, value, group: null });
  }

  return [...aggregated.values()].sort((a, b) => {
    const keyDiff = getGenderSortKey(a.label) - getGenderSortKey(b.label);
    if (keyDiff !== 0) return keyDiff;
    return a.label.localeCompare(b.label, 'ko-KR');
  });
}

function buildDeathRows(rows: JsonRecord[]): BaseAggregatedRow[] {
  const aggregated = new Map<string, BaseAggregatedRow>();

  for (const row of rows) {
    const label = pickString(row, ['icdNm']);
    if (!label || label === '계') continue;
    const value = parseNumericValue(row.resultVal);
    const group = pickString(row, ['icdGroupNm']);
    const existing = aggregated.get(label);
    if (existing) {
      existing.value += value;
      if (!existing.group && group) existing.group = group;
      continue;
    }
    aggregated.set(label, { label, value, group });
  }

  return [...aggregated.values()].sort(sortByValueDesc);
}

function buildSummary(args: {
  diseaseRows: BaseAggregatedRow[];
  selectedDisease: string | null;
  ageRows: BaseAggregatedRow[];
  genderRows: BaseAggregatedRow[];
  deathRows: BaseAggregatedRow[];
}): DistributionSummary {
  const topDisease = args.diseaseRows[0] ?? null;
  const selectedDiseaseRow = args.selectedDisease
    ? args.diseaseRows.find((row) => row.label === args.selectedDisease) ?? null
    : null;
  const peakAge = args.ageRows.reduce<BaseAggregatedRow | null>((acc, row) => {
    if (!acc || row.value > acc.value) return row;
    return acc;
  }, null);
  const peakGender = args.genderRows.reduce<BaseAggregatedRow | null>((acc, row) => {
    if (!acc || row.value > acc.value) return row;
    return acc;
  }, null);
  const deathTop = args.deathRows[0] ?? null;
  const deathTotal = args.deathRows.reduce((acc, row) => acc + row.value, 0);

  return {
    diseaseCount: args.diseaseRows.length,
    topDiseaseName: topDisease?.label ?? null,
    topDiseaseValue: topDisease?.value ?? null,
    selectedDiseaseName: selectedDiseaseRow?.label ?? args.selectedDisease ?? null,
    selectedDiseaseValue: selectedDiseaseRow?.value ?? null,
    peakAgeLabel: peakAge?.label ?? null,
    peakAgeValue: peakAge?.value ?? null,
    peakGenderLabel: peakGender?.label ?? null,
    peakGenderValue: peakGender?.value ?? null,
    deathTotal: args.deathRows.length > 0 ? deathTotal : null,
    deathTopDiseaseName: deathTop?.label ?? null,
    deathTopDiseaseValue: deathTop?.value ?? null,
  };
}

export async function GET(request: Request) {
  const apiKey =
    process.env.TEAM2_HEALTH_INFECTIOUS_DISTRIBUTION_API_KEY
    ?? process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_API_KEY
    ?? process.env.TEAM2_HEALTH_INFECTIOUS_RISK_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  const currentYear = getCurrentYear();
  const availableYears = buildAvailableYears();

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: null,
        filters: {
          availableYears,
          selectedYear: currentYear,
          diseaseOptions: [],
        },
        warnings: ['Missing env: TEAM2_HEALTH_INFECTIOUS_DISTRIBUTION_API_KEY (or TEAM2_HEALTH_INFECTIOUS_TRENDS_API_KEY / TEAM2_HEALTH_INFECTIOUS_RISK_API_KEY / TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_HEALTH_API_KEY / TEAM2_PUBLIC_API_KEY)'],
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
  const year = Math.min(getCurrentYear(), parseRequestedYear(url.searchParams.get('year'), currentYear));
  const metric = parseRequestedMetric(url.searchParams.get('metric'));
  const requestedDisease = parseRequestedDisease(url.searchParams.get('disease'));
  const pageSize = toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_DISTRIBUTION_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const maxPages = toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_DISTRIBUTION_MAX_PAGES, DEFAULT_MAX_PAGES);

  const [diseaseResult, ageResult, genderResult, deathResult] = await Promise.all([
    fetchEndpointRows({
      endpoint: DISEASE_ENDPOINT,
      endpointLabel: 'KDCA Disease',
      kind: 'disease',
      apiKey,
      metric,
      year,
      pageSize,
      maxPages,
    }),
    fetchEndpointRows({
      endpoint: AGE_ENDPOINT,
      endpointLabel: 'KDCA Age',
      kind: 'age',
      apiKey,
      metric,
      year,
      pageSize,
      maxPages,
    }),
    fetchEndpointRows({
      endpoint: GENDER_ENDPOINT,
      endpointLabel: 'KDCA Gender',
      kind: 'gender',
      apiKey,
      metric,
      year,
      pageSize,
      maxPages,
    }),
    fetchEndpointRows({
      endpoint: DEATH_ENDPOINT,
      endpointLabel: 'KDCA death',
      kind: 'death',
      apiKey,
      metric,
      year,
      pageSize,
      maxPages,
    }),
  ]);

  const diseaseRows = buildDiseaseRows(diseaseResult.rows);
  const diseaseOptions = buildDiseaseOptions(diseaseRows);
  const selectedDisease = resolveSelectedDisease(requestedDisease, diseaseOptions);
  const ageRows = buildAgeRows(ageResult.rows, selectedDisease);
  const genderRows = buildGenderRows(genderResult.rows, selectedDisease);
  const deathRows = buildDeathRows(deathResult.rows);
  const summary = buildSummary({
    diseaseRows,
    selectedDisease,
    ageRows,
    genderRows,
    deathRows,
  });
  const warnings = Array.from(
    new Set([
      ...diseaseResult.warnings,
      ...ageResult.warnings,
      ...genderResult.warnings,
      ...deathResult.warnings,
      requestedDisease && requestedDisease !== selectedDisease ? `Requested disease not found: ${requestedDisease}` : '',
    ].filter(Boolean))
  );

  if (diseaseRows.length === 0 && ageRows.length === 0 && genderRows.length === 0 && deathRows.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: null,
        filters: {
          availableYears,
          selectedYear: year,
          diseaseOptions: [],
        },
        warnings,
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
      filters: {
        availableYears,
        selectedYear: year,
        diseaseOptions,
      },
      data: {
        layerKind: 'infectious-distribution',
        sourceLabel: SOURCE_LABEL,
        year,
        yearLabel: `${year}년`,
        metric,
        metricLabel: getMetricLabel(metric),
        selectedDisease,
        selectedDiseaseLabel: selectedDisease,
        topDiseases: toDistributionRows(diseaseRows.slice(0, 10)),
        ageBreakdown: toDistributionRows(ageRows),
        genderBreakdown: toDistributionRows(genderRows),
        deathBreakdown: toDistributionRows(deathRows.slice(0, 10)),
        summary,
      },
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
