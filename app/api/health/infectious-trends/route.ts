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

const PERIOD_BASIC_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/PeriodBasic';
const PERIOD_REGION_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/PeriodRegion';
const PERIOD_PTNT_ENDPOINT = 'https://apis.data.go.kr/1790387/EIDAPIService/PeriodPtnt';
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_AVAILABLE_YEAR_RANGE = 6;
const SOURCE_LABEL = '질병관리청 전수신고 감염병 발생현황';

export const runtime = 'nodejs';

type PeriodType = 'year' | 'month' | 'week';
type PeriodSearchType = '1' | '2' | '3';
type EndpointKind = 'basic' | 'region' | 'patient';

interface DiseaseOption {
  value: string;
  label: string;
  group: string | null;
}

interface TrendPoint {
  period: string;
  sortKey: number;
  total: number;
  domestic: number | null;
  overseas: number | null;
  patient: number | null;
  suspected: number | null;
  carrier: number | null;
}

interface TrendSummary {
  latestPeriod: string | null;
  latestTotal: number | null;
  previousPeriod: string | null;
  previousTotal: number | null;
  changePct: number | null;
  peakPeriod: string | null;
  peakValue: number | null;
  pointCount: number;
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

function parseRequestedPeriodType(value: string | null): PeriodType {
  if (value === 'month') return 'month';
  if (value === 'week') return 'week';
  return 'year';
}

function parseRequestedYear(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < 2000 || parsed > 2100) return fallback;
  return parsed;
}

function parseRequestedDisease(value: string | null): string | null {
  if (!value) return null;
  const normalized = compactText(value);
  return normalized || null;
}

function getSearchPeriodType(periodType: PeriodType): PeriodSearchType {
  if (periodType === 'month') return '2';
  if (periodType === 'week') return '3';
  return '1';
}

function getPeriodTypeLabel(periodType: PeriodType): string {
  if (periodType === 'month') return '월별';
  if (periodType === 'week') return '주별';
  return '연도별';
}

function getCurrentYear(): number {
  return new Date().getFullYear();
}

function buildAvailableYears(): number[] {
  const currentYear = getCurrentYear();
  return Array.from({ length: DEFAULT_AVAILABLE_YEAR_RANGE + 1 }, (_value, index) => currentYear - index);
}

function normalizeYearRange(args: {
  startYear: number;
  endYear: number;
  periodType: PeriodType;
}): { startYear: number; endYear: number } {
  const currentYear = getCurrentYear();
  let startYear = Math.max(2000, Math.min(args.startYear, currentYear));
  let endYear = Math.max(2000, Math.min(args.endYear, currentYear));

  if (startYear > endYear) {
    [startYear, endYear] = [endYear, startYear];
  }

  const maxRangeYears = args.periodType === 'week' ? 2 : args.periodType === 'month' ? 3 : 6;
  if (endYear - startYear + 1 > maxRangeYears) {
    startYear = endYear - maxRangeYears + 1;
  }

  return { startYear, endYear };
}

function parseNumericValue(value: unknown): number {
  const parsed = toNumber(value);
  if (parsed === null) return 0;
  return parsed;
}

function extractPeriodRowsFromXml(xml: string, kind: EndpointKind): JsonRecord[] {
  const items = extractXmlItems(xml, 'item');
  return items.map((itemXml) => ({
    period: extractXmlTagValue(itemXml, 'period'),
    icdGroupNm: extractXmlTagValue(itemXml, 'icdGroupNm'),
    icdNm: extractXmlTagValue(itemXml, 'icdNm'),
    resultVal: extractXmlTagValue(itemXml, 'resultVal'),
    ...(kind === 'region'
      ? {
          dmstcVal: extractXmlTagValue(itemXml, 'dmstcVal'),
          outnatnVal: extractXmlTagValue(itemXml, 'outnatnVal'),
        }
      : {}),
    ...(kind === 'patient'
      ? {
          ptntVal: extractXmlTagValue(itemXml, 'ptntVal'),
          dbtptntVal: extractXmlTagValue(itemXml, 'dbtptntVal'),
          pthgnHolderVal: extractXmlTagValue(itemXml, 'pthgnHolderVal'),
        }
      : {}),
  }));
}

async function fetchPeriodPage(args: {
  endpoint: string;
  endpointLabel: string;
  kind: EndpointKind;
  apiKey: string;
  periodType: PeriodType;
  startYear: number;
  endYear: number;
  pageNo: number;
  pageSize: number;
}): Promise<PageFetchResult> {
  const url = new URL(args.endpoint);
  url.searchParams.set('serviceKey', args.apiKey);
  url.searchParams.set('resType', '2');
  url.searchParams.set('searchPeriodType', getSearchPeriodType(args.periodType));
  url.searchParams.set('searchStartYear', String(args.startYear));
  url.searchParams.set('searchEndYear', String(args.endYear));
  url.searchParams.set('pageNo', String(args.pageNo));
  url.searchParams.set('numOfRows', String(args.pageSize));

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
      rows: extractPeriodRowsFromXml(text, args.kind),
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
  periodType: PeriodType;
  startYear: number;
  endYear: number;
  pageSize: number;
  maxPages: number;
}): Promise<EndpointRowsResult> {
  const warnings: string[] = [];

  const firstPage = await fetchPeriodPage({
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
    const page = await fetchPeriodPage({
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

  return {
    rows,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
  };
}

function getPeriodSortKey(period: string, periodType: PeriodType): number | null {
  const normalized = compactText(period);
  if (!normalized || normalized === '계') return null;

  const yearMatch = normalized.match(/(\d{4})년/);
  const year = yearMatch?.[1] ? Number(yearMatch[1]) : null;
  if (!year) return null;

  if (periodType === 'year') {
    return year;
  }

  if (periodType === 'month') {
    const monthMatch = normalized.match(/(\d{1,2})월/);
    const month = monthMatch?.[1] ? Number(monthMatch[1]) : null;
    return month ? year * 100 + month : null;
  }

  const weekMatch = normalized.match(/(\d{1,2})주/);
  const week = weekMatch?.[1] ? Number(weekMatch[1]) : null;
  return week ? year * 100 + week : null;
}

function aggregateOverallSeries(args: {
  rows: JsonRecord[];
  periodType: PeriodType;
  disease: string | null;
}): TrendPoint[] {
  const grouped = new Map<string, TrendPoint>();

  for (const row of args.rows) {
    const period = pickString(row, ['period']);
    const diseaseName = pickString(row, ['icdNm']);
    if (!period || !diseaseName) continue;
    if (args.disease && diseaseName !== args.disease) continue;

    const sortKey = getPeriodSortKey(period, args.periodType);
    if (sortKey === null) continue;

    const current = grouped.get(period) ?? {
      period,
      sortKey,
      total: 0,
      domestic: null,
      overseas: null,
      patient: null,
      suspected: null,
      carrier: null,
    };

    current.total += parseNumericValue(row.resultVal);
    grouped.set(period, current);
  }

  return [...grouped.values()].sort((a, b) => a.sortKey - b.sortKey);
}

function aggregateRegionSeries(args: {
  rows: JsonRecord[];
  periodType: PeriodType;
  disease: string | null;
}): TrendPoint[] {
  const grouped = new Map<string, TrendPoint>();

  for (const row of args.rows) {
    const period = pickString(row, ['period']);
    const diseaseName = pickString(row, ['icdNm']);
    if (!period || !diseaseName) continue;
    if (args.disease && diseaseName !== args.disease) continue;

    const sortKey = getPeriodSortKey(period, args.periodType);
    if (sortKey === null) continue;

    const current = grouped.get(period) ?? {
      period,
      sortKey,
      total: 0,
      domestic: 0,
      overseas: 0,
      patient: null,
      suspected: null,
      carrier: null,
    };

    current.total += parseNumericValue(row.resultVal);
    current.domestic = (current.domestic ?? 0) + parseNumericValue(row.dmstcVal);
    current.overseas = (current.overseas ?? 0) + parseNumericValue(row.outnatnVal);
    grouped.set(period, current);
  }

  return [...grouped.values()].sort((a, b) => a.sortKey - b.sortKey);
}

function aggregatePatientSeries(args: {
  rows: JsonRecord[];
  periodType: PeriodType;
  disease: string | null;
}): TrendPoint[] {
  const grouped = new Map<string, TrendPoint>();

  for (const row of args.rows) {
    const period = pickString(row, ['period']);
    const diseaseName = pickString(row, ['icdNm']);
    if (!period || !diseaseName) continue;
    if (args.disease && diseaseName !== args.disease) continue;

    const sortKey = getPeriodSortKey(period, args.periodType);
    if (sortKey === null) continue;

    const current = grouped.get(period) ?? {
      period,
      sortKey,
      total: 0,
      domestic: null,
      overseas: null,
      patient: 0,
      suspected: 0,
      carrier: 0,
    };

    current.total += parseNumericValue(row.resultVal);
    current.patient = (current.patient ?? 0) + parseNumericValue(row.ptntVal);
    current.suspected = (current.suspected ?? 0) + parseNumericValue(row.dbtptntVal);
    current.carrier = (current.carrier ?? 0) + parseNumericValue(row.pthgnHolderVal);
    grouped.set(period, current);
  }

  return [...grouped.values()].sort((a, b) => a.sortKey - b.sortKey);
}

function buildDiseaseOptions(rows: JsonRecord[]): DiseaseOption[] {
  const grouped = new Map<string, { label: string; group: string | null; total: number }>();

  for (const row of rows) {
    const label = pickString(row, ['icdNm']);
    if (!label) continue;
    const group = pickString(row, ['icdGroupNm']);
    const current = grouped.get(label) ?? { label, group, total: 0 };
    current.total += parseNumericValue(row.resultVal);
    grouped.set(label, current);
  }

  return [...grouped.values()]
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.label.localeCompare(b.label, 'ko');
    })
    .map((item) => ({
      value: item.label,
      label: item.label,
      group: item.group,
    }));
}

function buildTrendSummary(series: TrendPoint[]): TrendSummary {
  const latest = series.at(-1) ?? null;
  const previous = series.length > 1 ? series.at(-2) ?? null : null;
  const peak = series.reduce<TrendPoint | null>((acc, point) => {
    if (!acc || point.total > acc.total) return point;
    return acc;
  }, null);

  const changePct = latest && previous && previous.total > 0
    ? Number((((latest.total - previous.total) / previous.total) * 100).toFixed(1))
    : null;

  return {
    latestPeriod: latest?.period ?? null,
    latestTotal: latest?.total ?? null,
    previousPeriod: previous?.period ?? null,
    previousTotal: previous?.total ?? null,
    changePct,
    peakPeriod: peak?.period ?? null,
    peakValue: peak?.total ?? null,
    pointCount: series.length,
  };
}

export async function GET(request: Request) {
  const apiKey =
    process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_API_KEY
    ?? process.env.TEAM2_HEALTH_INFECTIOUS_RISK_API_KEY
    ?? process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: null,
        filters: {
          availableYears: buildAvailableYears(),
          selectedPeriodType: 'year',
          selectedStartYear: getCurrentYear() - 1,
          selectedEndYear: getCurrentYear(),
          selectedDisease: null,
          diseaseOptions: [],
        },
        warnings: ['Missing env: TEAM2_HEALTH_INFECTIOUS_TRENDS_API_KEY (or TEAM2_HEALTH_INFECTIOUS_RISK_API_KEY / TEAM2_DISASTER_WILDFIRE_API_KEY / TEAM2_HEALTH_API_KEY / TEAM2_PUBLIC_API_KEY)'],
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
  const periodType = parseRequestedPeriodType(url.searchParams.get('periodType'));
  const currentYear = getCurrentYear();
  const rawStartYear = parseRequestedYear(url.searchParams.get('startYear'), currentYear - 1);
  const rawEndYear = parseRequestedYear(url.searchParams.get('endYear'), currentYear);
  const disease = parseRequestedDisease(url.searchParams.get('disease'));
  const { startYear, endYear } = normalizeYearRange({
    startYear: rawStartYear,
    endYear: rawEndYear,
    periodType,
  });

  const [basicResult, regionResult, patientResult] = await Promise.all([
    fetchEndpointRows({
      endpoint: PERIOD_BASIC_ENDPOINT,
      endpointLabel: 'KDCA PeriodBasic',
      kind: 'basic',
      apiKey,
      periodType,
      startYear,
      endYear,
      pageSize: toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_PAGE_SIZE, DEFAULT_PAGE_SIZE),
      maxPages: toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_MAX_PAGES, DEFAULT_MAX_PAGES),
    }),
    fetchEndpointRows({
      endpoint: PERIOD_REGION_ENDPOINT,
      endpointLabel: 'KDCA PeriodRegion',
      kind: 'region',
      apiKey,
      periodType,
      startYear,
      endYear,
      pageSize: toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_PAGE_SIZE, DEFAULT_PAGE_SIZE),
      maxPages: toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_MAX_PAGES, DEFAULT_MAX_PAGES),
    }),
    fetchEndpointRows({
      endpoint: PERIOD_PTNT_ENDPOINT,
      endpointLabel: 'KDCA PeriodPtnt',
      kind: 'patient',
      apiKey,
      periodType,
      startYear,
      endYear,
      pageSize: toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_PAGE_SIZE, DEFAULT_PAGE_SIZE),
      maxPages: toPositiveInt(process.env.TEAM2_HEALTH_INFECTIOUS_TRENDS_MAX_PAGES, DEFAULT_MAX_PAGES),
    }),
  ]);

  const diseaseOptions = buildDiseaseOptions(basicResult.rows);
  const overallSeries = aggregateOverallSeries({
    rows: basicResult.rows,
    periodType,
    disease,
  });
  const regionSeries = aggregateRegionSeries({
    rows: regionResult.rows,
    periodType,
    disease,
  });
  const patientSeries = aggregatePatientSeries({
    rows: patientResult.rows,
    periodType,
    disease,
  });
  const warnings = Array.from(
    new Set([
      ...basicResult.warnings,
      ...regionResult.warnings,
      ...patientResult.warnings,
    ].filter(Boolean))
  );

  if (overallSeries.length === 0 && regionSeries.length === 0 && patientSeries.length === 0) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: null,
        filters: {
          availableYears: buildAvailableYears(),
          selectedPeriodType: periodType,
          selectedStartYear: startYear,
          selectedEndYear: endYear,
          selectedDisease: disease,
          diseaseOptions,
        },
        warnings: warnings.length > 0 ? warnings : ['KDCA infectious trends returned no rows'],
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
        layerKind: 'infectious-trends',
        sourceLabel: SOURCE_LABEL,
        periodType,
        periodTypeLabel: getPeriodTypeLabel(periodType),
        startYear,
        endYear,
        disease,
        diseaseLabel: disease,
        overallSeries,
        regionSeries,
        patientSeries,
        summary: buildTrendSummary(overallSeries),
      },
      filters: {
        availableYears: buildAvailableYears(),
        selectedPeriodType: periodType,
        selectedStartYear: startYear,
        selectedEndYear: endYear,
        selectedDisease: disease,
        diseaseOptions,
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
