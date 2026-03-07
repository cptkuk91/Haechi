import { NextResponse } from 'next/server';
import {
  clampInt,
  compactText,
  extractResultWarningFromCommonJson,
  extractRowsFromCommonJson,
  pickNumber,
  pickString,
  toPositiveInt,
  type JsonRecord,
} from '@/app/api/_shared/parse-primitives';
import { extractXmlItems, extractXmlTagValue } from '@/app/api/_shared/xml-utils';
import { fetchEmergencyCapacityIndex } from '@/app/api/health/_shared/emergency-capacity';

const DEFAULT_UPSTREAM_URL = 'https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytBassInfoInqire';

function extractRowsFromXml(xml: string): JsonRecord[] {
  const matches = extractXmlItems(xml, 'item');
  const rows: JsonRecord[] = [];
  for (const itemXml of matches) {
    rows.push({
      hpid: extractXmlTagValue(itemXml, 'hpid'),
      dutyName: extractXmlTagValue(itemXml, 'dutyName'),
      dutyAddr: extractXmlTagValue(itemXml, 'dutyAddr'),
      dutyTel1: extractXmlTagValue(itemXml, 'dutyTel1'),
      dutyTel3: extractXmlTagValue(itemXml, 'dutyTel3'),
      dgidIdName: extractXmlTagValue(itemXml, 'dgidIdName'),
      hperyn: extractXmlTagValue(itemXml, 'hperyn'),
      hpbdn: extractXmlTagValue(itemXml, 'hpbdn'),
      hvec: extractXmlTagValue(itemXml, 'hvec'),
    });
  }
  return rows;
}

async function fetchBaseInfo(args: {
  apiKey: string;
  hpid: string;
  upstreamUrl: string;
}): Promise<{ row: JsonRecord | null; warning?: string }> {
  const url = new URL(args.upstreamUrl);
  if (!url.searchParams.has('serviceKey')) {
    url.searchParams.set('serviceKey', args.apiKey);
  }
  url.searchParams.set('HPID', args.hpid);
  url.searchParams.set('_type', 'json');
  url.searchParams.set('resultType', 'json');

  const response = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    return {
      row: null,
      warning: `NMC emergency base upstream responded ${response.status}`,
    };
  }

  const text = await response.text();
  if (!text.trim()) {
    return {
      row: null,
      warning: 'NMC emergency base upstream returned empty body',
    };
  }

  try {
    const json = JSON.parse(text);
    const warning = extractResultWarningFromCommonJson(json, 'NMC emergency base API') ?? undefined;
    const rows = extractRowsFromCommonJson(json);
    return {
      row: rows[0] ?? null,
      warning,
    };
  } catch {
    const rows = extractRowsFromXml(text);
    return {
      row: rows[0] ?? null,
    };
  }
}

function deriveSeverity(occupancyPct: number | null, availableBeds: number | null): 'info' | 'warning' | 'critical' | null {
  if (occupancyPct !== null) {
    if (occupancyPct >= 90) return 'critical';
    if (occupancyPct >= 75) return 'warning';
    return 'info';
  }
  if (availableBeds === null) return null;
  if (availableBeds <= 0) return 'critical';
  if (availableBeds <= 3) return 'warning';
  return 'info';
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const hpid = compactText(searchParams.get('hpid') ?? '');
  if (!hpid) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: null,
        warnings: ['Missing query: hpid'],
      },
      {
        status: 400,
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const apiKey =
    process.env.TEAM2_DISASTER_WILDFIRE_API_KEY
    ?? process.env.TEAM2_HEALTH_API_KEY
    ?? process.env.TEAM2_PUBLIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        data: null,
        warnings: ['Missing env: TEAM2_DISASTER_WILDFIRE_API_KEY (or TEAM2_HEALTH_API_KEY / TEAM2_PUBLIC_API_KEY)'],
      },
      {
        headers: {
          'cache-control': 'no-store, max-age=0',
          'x-team2-source': 'mock',
        },
      }
    );
  }

  const upstreamUrl = process.env.TEAM2_HEALTH_EMERGENCY_BASE_UPSTREAM_URL ?? DEFAULT_UPSTREAM_URL;
  const warnings: string[] = [];

  const [capacityResult, baseResult] = await Promise.all([
    fetchEmergencyCapacityIndex({
      apiKey,
      pageSize: clampInt(
        toPositiveInt(process.env.TEAM2_HEALTH_EMERGENCY_CAPACITY_PAGE_SIZE, 1000),
        1,
        1000
      ),
      maxPages: clampInt(
        toPositiveInt(process.env.TEAM2_HEALTH_EMERGENCY_CAPACITY_MAX_PAGES, 5),
        1,
        50
      ),
    }),
    fetchBaseInfo({
      apiKey,
      hpid,
      upstreamUrl,
    }),
  ]);

  warnings.push(...capacityResult.warnings);
  if (baseResult.warning) warnings.push(baseResult.warning);

  const snapshot = capacityResult.byHpid.get(hpid);
  const base = baseResult.row;
  const totalEmergencyBedsRaw = pickNumber(base ?? {}, ['hperyn']);
  const totalEmergencyBeds = totalEmergencyBedsRaw !== null && totalEmergencyBedsRaw > 0
    ? Math.trunc(totalEmergencyBedsRaw)
    : null;
  const availableBeds = snapshot?.availableBeds ?? null;
  const overloadBeds = snapshot?.overloadBeds ?? 0;
  const occupancyPct =
    totalEmergencyBeds !== null && availableBeds !== null
      ? clampInt(Math.round(((totalEmergencyBeds - availableBeds) / Math.max(1, totalEmergencyBeds)) * 100), 0, 100)
      : null;
  const severity = deriveSeverity(occupancyPct, availableBeds);

  const data = (snapshot || base)
    ? {
        hpid,
        name: snapshot?.name ?? pickString(base ?? {}, ['dutyName', 'name']),
        address: pickString(base ?? {}, ['dutyAddr', 'address']),
        phone: pickString(base ?? {}, ['dutyTel3', 'dutyTel1', 'phone']),
        departments: pickString(base ?? {}, ['dgidIdName']),
        totalEmergencyBeds,
        totalHospitalBeds: pickNumber(base ?? {}, ['hpbdn']),
        availableBeds,
        overloadBeds,
        availableOperatingRooms: snapshot?.availableOperatingRooms ?? null,
        availableGeneralBeds: snapshot?.availableGeneralBeds ?? null,
        availableNeonatalIcuBeds: snapshot?.availableNeonatalIcuBeds ?? null,
        occupancyPct,
        severity,
        lastUpdated: snapshot?.lastUpdated ?? null,
        ctAvailable: snapshot?.ctAvailable ?? null,
        mriAvailable: snapshot?.mriAvailable ?? null,
        ventilatorAvailable: snapshot?.ventilatorAvailable ?? null,
        ecmoAvailable: snapshot?.ecmoAvailable ?? null,
        crrtAvailable: snapshot?.crrtAvailable ?? null,
        angiographyAvailable: snapshot?.angiographyAvailable ?? null,
        oxygenAvailable: snapshot?.oxygenAvailable ?? null,
        incubatorAvailable: snapshot?.incubatorAvailable ?? null,
      }
    : null;

  return NextResponse.json(
    {
      source: data ? 'upstream' : 'mock',
      updatedAt: new Date().toISOString(),
      data,
      warnings,
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': data ? 'upstream' : 'mock',
      },
    }
  );
}
