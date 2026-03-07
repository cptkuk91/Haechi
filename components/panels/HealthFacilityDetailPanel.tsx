'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, BedDouble, Building2, Clock3, MapPin, Phone } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import type { SelectedObject } from '@/types/domain';

interface HealthFacilityDetailPanelProps {
  selectedObject: SelectedObject;
}

interface HealthFacilityStatusResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  data?: {
    hpid?: string;
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    departments?: string | null;
    totalEmergencyBeds?: number | null;
    totalHospitalBeds?: number | null;
    availableBeds?: number | null;
    overloadBeds?: number | null;
    availableOperatingRooms?: number | null;
    availableGeneralBeds?: number | null;
    availableNeonatalIcuBeds?: number | null;
    occupancyPct?: number | null;
    severity?: string | null;
    lastUpdated?: string | null;
    ctAvailable?: boolean | null;
    mriAvailable?: boolean | null;
    ventilatorAvailable?: boolean | null;
    ecmoAvailable?: boolean | null;
    crrtAvailable?: boolean | null;
    angiographyAvailable?: boolean | null;
    oxygenAvailable?: boolean | null;
    incubatorAvailable?: boolean | null;
  } | null;
  warnings?: string[];
}

type SupportAvailabilityKey =
  | 'ctAvailable'
  | 'mriAvailable'
  | 'ventilatorAvailable'
  | 'ecmoAvailable'
  | 'crrtAvailable'
  | 'angiographyAvailable'
  | 'oxygenAvailable'
  | 'incubatorAvailable';

function pickFirstString(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function formatMetric(value: number | null, suffix = ''): string {
  if (value === null) return '현재 정보 없음';
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}${suffix}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return '실시간 동기화';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ko-KR', { hour12: false });
}

function classifyCapacity(occupancyPct: number | null): {
  label: string;
  accentClass: string;
  barClass: string;
} {
  if (occupancyPct === null) {
    return {
      label: '현재 정보 없음',
      accentClass: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200',
      barClass: 'from-emerald-400/70 via-teal-300/50 to-cyan-300/20',
    };
  }
  if (occupancyPct >= 90) {
    return {
      label: '임계',
      accentClass: 'border-rose-400/25 bg-rose-500/12 text-rose-100',
      barClass: 'from-rose-500 via-orange-400 to-amber-300',
    };
  }
  if (occupancyPct >= 75) {
    return {
      label: '주의',
      accentClass: 'border-amber-400/25 bg-amber-500/12 text-amber-100',
      barClass: 'from-amber-500 via-orange-300 to-yellow-200',
    };
  }
  return {
    label: '원활',
    accentClass: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
    barClass: 'from-emerald-500 via-teal-300 to-cyan-200',
  };
}

function isHealthFacilitySelection(selectedObject: SelectedObject): boolean {
  if (selectedObject.domain !== 'health') return false;
  const properties = selectedObject.properties;
  return (
    typeof properties.hpid === 'string'
    || typeof properties.facilityCategory === 'string'
    || typeof properties.institutionType === 'string'
  );
}

async function fetchHealthFacilityStatus(hpid: string): Promise<HealthFacilityStatusResponse> {
  const response = await fetch(`/api/health/facility-status?hpid=${encodeURIComponent(hpid)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Failed to load health facility status: ${response.status}`);
  }
  return (await response.json()) as HealthFacilityStatusResponse;
}

function supportChipClass(enabled: boolean | null): string {
  if (enabled === true) return 'border-emerald-400/20 bg-emerald-500/12 text-emerald-50';
  if (enabled === false) return 'border-zinc-700/40 bg-zinc-900/40 text-zinc-400';
  return 'border-cyan-900/30 bg-cyan-950/20 text-cyan-300/70';
}

const SUPPORT_ITEMS: ReadonlyArray<readonly [string, SupportAvailabilityKey]> = [
  ['CT', 'ctAvailable'],
  ['MRI', 'mriAvailable'],
  ['VENT', 'ventilatorAvailable'],
  ['ECMO', 'ecmoAvailable'],
  ['CRRT', 'crrtAvailable'],
  ['ANGIO', 'angiographyAvailable'],
  ['O2', 'oxygenAvailable'],
  ['INCU', 'incubatorAvailable'],
];

export function HealthFacilityDetailPanel({ selectedObject }: HealthFacilityDetailPanelProps) {
  const hpid = pickFirstString(selectedObject.properties, ['hpid']);
  const query = useQuery({
    queryKey: ['health', 'facility-status', hpid],
    queryFn: () => fetchHealthFacilityStatus(hpid!),
    enabled: Boolean(hpid),
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  const detail = useMemo(() => {
    if (!isHealthFacilitySelection(selectedObject)) return null;

    const properties = selectedObject.properties;
    const live = query.data?.data ?? null;
    const name = pickFirstString(properties, ['name', 'dutyName']) ?? '의료기관';
    const categoryLabel = pickFirstString(properties, ['facilityCategoryLabel'])
      ?? pickFirstString(properties, ['institutionType'])
      ?? '의료기관';
    const institutionType = pickFirstString(properties, ['institutionType', 'dutyEmclsName']) ?? categoryLabel;
    const address = (typeof live?.address === 'string' && live.address.trim())
      ? live.address.trim()
      : pickFirstString(properties, ['address', 'dutyAddr']);
    const phone = (typeof live?.phone === 'string' && live.phone.trim())
      ? live.phone.trim()
      : pickFirstString(properties, ['phone', 'dutyTel3', 'dutyTel1']);
    const source = query.data?.source?.toUpperCase() ?? pickFirstString(properties, ['source'])?.toUpperCase() ?? 'UPSTREAM';
    const updatedAt = (typeof live?.lastUpdated === 'string' && live.lastUpdated.trim())
      ? live.lastUpdated.trim()
      : pickFirstString(properties, ['updatedAt', 'syncedAt', 'lastUpdated']);
    const occupancyPct = toNumber(live?.occupancyPct ?? properties.occupancyPct);
    const availableBeds = toNumber(live?.availableBeds ?? properties.availableBeds);
    const totalEmergencyBeds = toNumber(live?.totalEmergencyBeds);
    const overloadBeds = toNumber(live?.overloadBeds);
    const availableOperatingRooms = toNumber(live?.availableOperatingRooms ?? properties.availableOperatingRooms);
    const availableGeneralBeds = toNumber(live?.availableGeneralBeds ?? properties.availableGeneralBeds);
    const availableNeonatalIcuBeds = toNumber(live?.availableNeonatalIcuBeds ?? properties.availableNeonatalIcuBeds);
    const departments = typeof live?.departments === 'string' && live.departments.trim() ? live.departments.trim() : null;
    const severity = (typeof live?.severity === 'string' && live.severity.trim())
      ? live.severity.trim()
      : pickFirstString(properties, ['severity']);
    const capacityState = classifyCapacity(occupancyPct);

    return {
      name,
      categoryLabel,
      institutionType,
      address,
      phone,
      hpid: live?.hpid ?? hpid,
      source,
      updatedAt,
      occupancyPct,
      availableBeds,
      totalEmergencyBeds,
      overloadBeds,
      availableOperatingRooms,
      availableGeneralBeds,
      availableNeonatalIcuBeds,
      departments,
      severity,
      capacityState,
      ctAvailable: typeof live?.ctAvailable === 'boolean' ? live.ctAvailable : null,
      mriAvailable: typeof live?.mriAvailable === 'boolean' ? live.mriAvailable : null,
      ventilatorAvailable: typeof live?.ventilatorAvailable === 'boolean' ? live.ventilatorAvailable : null,
      ecmoAvailable: typeof live?.ecmoAvailable === 'boolean' ? live.ecmoAvailable : null,
      crrtAvailable: typeof live?.crrtAvailable === 'boolean' ? live.crrtAvailable : null,
      angiographyAvailable: typeof live?.angiographyAvailable === 'boolean' ? live.angiographyAvailable : null,
      oxygenAvailable: typeof live?.oxygenAvailable === 'boolean' ? live.oxygenAvailable : null,
      incubatorAvailable: typeof live?.incubatorAvailable === 'boolean' ? live.incubatorAvailable : null,
    };
  }, [hpid, query.data, selectedObject]);

  if (!detail) return null;

  const progressWidth = detail.occupancyPct === null ? 32 : Math.max(10, Math.min(100, detail.occupancyPct));

  return (
    <aside className="hidden xl:block w-[400px] max-h-[calc(100vh-2rem)] pointer-events-auto">
      <GlassCard
        title="Hospital Detail"
        subtitle={`${detail.categoryLabel} • ${detail.source}`}
        className="h-full overflow-hidden border-emerald-500/20 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_rgba(6,78,59,0.12)_24%,_rgba(10,15,20,0.92)_72%)] shadow-[0_0_42px_rgba(16,185,129,0.18)]"
      >
        <div className="flex h-full flex-col gap-4">
          <div className="rounded-[1.25rem] border border-emerald-400/18 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="inline-flex items-center rounded-full border border-emerald-400/18 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.24em] text-emerald-100">
                  {detail.categoryLabel}
                </div>
                <div>
                  <h3 className="text-[1.15rem] font-semibold tracking-[0.01em] text-emerald-50">
                    {detail.name}
                  </h3>
                  <p className="mt-1 text-[11px] tracking-[0.16em] text-emerald-200/75">
                    {detail.institutionType}
                  </p>
                </div>
              </div>
              <div className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] ${detail.capacityState.accentClass}`}>
                {detail.severity?.toUpperCase() ?? detail.capacityState.label}
              </div>
            </div>

            <div className="mt-4 space-y-2.5 text-[11px] text-emerald-100/85">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
                <span className="leading-5">{detail.address ?? '주소 정보 없음'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
                <span>{detail.phone ?? '대표 연락처 미확인'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-500/16 bg-emerald-500/8 p-3">
              <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-emerald-200/75">
                <Activity className="h-3.5 w-3.5" />
                수용률
              </div>
              <p className="mt-2 text-xl font-semibold text-emerald-50">
                {formatMetric(detail.occupancyPct, '%')}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/16 bg-emerald-500/8 p-3">
              <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-emerald-200/75">
                <BedDouble className="h-3.5 w-3.5" />
                가용 병상
              </div>
              <p className="mt-2 text-xl font-semibold text-emerald-50">
                {formatMetric(detail.availableBeds)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/16 bg-emerald-500/8 p-3">
              <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-emerald-200/75">
                <Building2 className="h-3.5 w-3.5" />
                총 응급실 병상
              </div>
              <p className="mt-2 text-xl font-semibold text-emerald-50">
                {formatMetric(detail.totalEmergencyBeds)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/16 bg-emerald-500/8 p-3">
              <div className="flex items-center gap-2 text-[10px] tracking-[0.16em] text-emerald-200/75">
                <Clock3 className="h-3.5 w-3.5" />
                마지막 갱신
              </div>
              <p className="mt-2 text-[13px] leading-5 text-emerald-50">
                {formatTimestamp(detail.updatedAt)}
              </p>
            </div>
          </div>

          <div className="rounded-[1.25rem] border border-emerald-400/18 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.24em] text-emerald-200/70">
                  CAPACITY SIGNAL
                </p>
                <p className="mt-1 text-sm text-emerald-50">
                  {detail.occupancyPct === null
                    ? '현재 정보 없음'
                    : `${detail.occupancyPct}% 수용률 기준 ${detail.capacityState.label} 상태`}
                </p>
              </div>
              <div className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] ${detail.capacityState.accentClass}`}>
                {detail.capacityState.label}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-950/70">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${detail.capacityState.barClass}`}
                style={{ width: `${progressWidth}%` }}
              />
            </div>
            <p className="mt-3 text-[11px] leading-5 text-emerald-100/70">
              {query.isFetching && !query.data?.data
                ? '실시간 병상 현황을 동기화하고 있습니다.'
                : detail.occupancyPct === null
                  ? '해당 기관은 현재 실시간 수용 현황 값을 제공하지 않거나 계산에 필요한 정보가 부족합니다.'
                  : '임계치 초과 기관은 alert feed와 함께 병원 상세 패널에서 우선 확인할 수 있도록 유지합니다.'}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-[11px] text-emerald-100/80">
            <div className="rounded-2xl border border-emerald-500/14 bg-emerald-500/6 p-3">
              <p className="text-[10px] tracking-[0.18em] text-emerald-200/65">수술실 가용</p>
              <p className="mt-2 text-emerald-50">{formatMetric(detail.availableOperatingRooms)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/14 bg-emerald-500/6 p-3">
              <p className="text-[10px] tracking-[0.18em] text-emerald-200/65">입원실 가용</p>
              <p className="mt-2 text-emerald-50">{formatMetric(detail.availableGeneralBeds)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/14 bg-emerald-500/6 p-3">
              <p className="text-[10px] tracking-[0.18em] text-emerald-200/65">신생아중환자</p>
              <p className="mt-2 text-emerald-50">{formatMetric(detail.availableNeonatalIcuBeds)}</p>
            </div>
          </div>

          {detail.overloadBeds && detail.overloadBeds > 0 ? (
            <div className="rounded-2xl border border-rose-400/18 bg-rose-500/10 px-3 py-2.5 text-[11px] text-rose-100">
              응급실 가용병상이 `-{detail.overloadBeds}`로 보고되어 과밀 상태로 해석됩니다.
            </div>
          ) : null}

          <div className="rounded-[1.25rem] border border-emerald-400/18 bg-black/20 p-4">
            <p className="text-[10px] font-semibold tracking-[0.24em] text-emerald-200/70">
              RESUSCITATION SUPPORT
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUPPORT_ITEMS.map(([label, key]) => (
                <span
                  key={label}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] ${supportChipClass(detail[key] as boolean | null)}`}
                >
                  {label}
                </span>
              ))}
            </div>
            {detail.departments ? (
              <p className="mt-3 text-[11px] leading-5 text-emerald-100/70 line-clamp-3">
                {detail.departments}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px] text-emerald-100/80">
            <div className="rounded-2xl border border-emerald-500/14 bg-emerald-500/6 p-3">
              <p className="text-[10px] tracking-[0.18em] text-emerald-200/65">HPID</p>
              <p className="mt-2 break-all text-emerald-50">{detail.hpid ?? '미확인'}</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/14 bg-emerald-500/6 p-3">
              <p className="text-[10px] tracking-[0.18em] text-emerald-200/65">DATA SOURCE</p>
              <p className="mt-2 text-emerald-50">{detail.source}</p>
            </div>
          </div>
        </div>
      </GlassCard>
    </aside>
  );
}
