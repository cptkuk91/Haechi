'use client';

import { useMemo, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { Activity, BarChart3, ChevronDown, ChevronUp, PanelRightClose, Skull, Users } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { useAppStore, type HealthInfectiousDistributionRow, type HealthInfectiousRiskMetric } from '@/stores/app-store';

const TOP_DISEASES_COLLAPSED_COUNT = 3;
const AGE_BREAKDOWN_COLLAPSED_COUNT = 5;
const DEATH_BREAKDOWN_COLLAPSED_COUNT = 3;

function formatMetricValue(value: number | null, metric: HealthInfectiousRiskMetric, forceCount = false): string {
  if (value === null || !Number.isFinite(value)) return '-';
  if (metric === 'incidence' && !forceCount) {
    return value.toFixed(2);
  }
  return value.toLocaleString('ko-KR');
}

function getMetricUnit(metric: HealthInfectiousRiskMetric, forceCount = false): string {
  if (metric === 'incidence' && !forceCount) return '/10만명';
  return '건';
}

function SummaryCard({
  label,
  value,
  subLabel,
}: {
  label: string;
  value: string;
  subLabel: string;
}) {
  return (
    <div className="rounded-xl border border-orange-900/30 bg-orange-950/18 px-3 py-2">
      <p className="text-[9px] tracking-[0.2em] text-orange-800">{label}</p>
      <p className="mt-1 text-[13px] font-semibold text-orange-100">{value}</p>
      <p className="mt-1 text-[9px] text-orange-300/75">{subLabel}</p>
    </div>
  );
}

function BarList({
  rows,
  metric,
  emptyText,
  forceCount = false,
}: {
  rows: HealthInfectiousDistributionRow[];
  metric: HealthInfectiousRiskMetric;
  emptyText: string;
  forceCount?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-orange-900/30 bg-orange-950/12 px-3 py-4 text-[10px] tracking-[0.16em] text-orange-400/70">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-xl border border-orange-900/25 bg-orange-950/15 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[10px] tracking-[0.12em] text-orange-100">{row.label}</p>
              {row.group ? (
                <p className="truncate text-[9px] text-orange-300/60">{row.group}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-[10px] text-orange-200/90">
              {formatMetricValue(row.value, metric, forceCount)}
              {getMetricUnit(metric, forceCount)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-orange-950/80">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(251,146,60,0.95),rgba(245,158,11,0.8))]"
              style={{ width: `${row.barPct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopDiseasesSection({
  rows,
  metric,
}: {
  rows: HealthInfectiousDistributionRow[];
  metric: HealthInfectiousRiskMetric;
}) {
  const [showAllTopDiseases, setShowAllTopDiseases] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-orange-100/90">
          <Activity className="h-3.5 w-3.5" />
          감염병별
        </div>
        {rows.length > TOP_DISEASES_COLLAPSED_COUNT ? (
          <button
            type="button"
            onClick={() => setShowAllTopDiseases((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full border border-orange-400/18 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-orange-100 transition-colors hover:border-orange-300/35 hover:bg-orange-500/16"
          >
            {showAllTopDiseases ? (
              <>
                접기
                <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                더 보기 {rows.length - TOP_DISEASES_COLLAPSED_COUNT}개
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        ) : null}
      </div>
      <BarList
        rows={showAllTopDiseases ? rows : rows.slice(0, TOP_DISEASES_COLLAPSED_COUNT)}
        metric={metric}
        emptyText="감염병별 집계가 없습니다."
      />
    </section>
  );
}

function AgeBreakdownSection({
  rows,
  metric,
}: {
  rows: HealthInfectiousDistributionRow[];
  metric: HealthInfectiousRiskMetric;
}) {
  const [showAllAges, setShowAllAges] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-orange-100/90">
          <BarChart3 className="h-3.5 w-3.5" />
          연령별
        </div>
        {rows.length > AGE_BREAKDOWN_COLLAPSED_COUNT ? (
          <button
            type="button"
            onClick={() => setShowAllAges((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full border border-orange-400/18 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-orange-100 transition-colors hover:border-orange-300/35 hover:bg-orange-500/16"
          >
            {showAllAges ? (
              <>
                접기
                <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                더 보기 {rows.length - AGE_BREAKDOWN_COLLAPSED_COUNT}개
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        ) : null}
      </div>
      <BarList
        rows={showAllAges ? rows : rows.slice(0, AGE_BREAKDOWN_COLLAPSED_COUNT)}
        metric={metric}
        emptyText="선택 감염병의 연령 분포가 없습니다."
      />
    </section>
  );
}

function DeathBreakdownSection({
  rows,
}: {
  rows: HealthInfectiousDistributionRow[];
}) {
  const [showAllDeaths, setShowAllDeaths] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-orange-100/90">
          <Skull className="h-3.5 w-3.5" />
          사망 현황
        </div>
        {rows.length > DEATH_BREAKDOWN_COLLAPSED_COUNT ? (
          <button
            type="button"
            onClick={() => setShowAllDeaths((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full border border-orange-400/18 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] text-orange-100 transition-colors hover:border-orange-300/35 hover:bg-orange-500/16"
          >
            {showAllDeaths ? (
              <>
                접기
                <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                더 보기 {rows.length - DEATH_BREAKDOWN_COLLAPSED_COUNT}개
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        ) : null}
      </div>
      <BarList
        rows={showAllDeaths ? rows : rows.slice(0, DEATH_BREAKDOWN_COLLAPSED_COUNT)}
        metric="count"
        forceCount
        emptyText="사망 현황 데이터가 없습니다."
      />
    </section>
  );
}

export function HealthInfectiousDistributionPanel() {
  const layerVisible = useAppStore((s) => s.layers['health-infectious-distribution']?.visible ?? false);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const filters = useAppStore((s) => s.healthInfectiousDistributionFilters);
  const meta = useAppStore((s) => s.healthInfectiousDistributionMeta);
  const data = useAppStore((s) => s.healthInfectiousDistributionData);
  const isFetching = useIsFetching({ queryKey: ['health', 'infectious-distribution'] }) > 0;

  const selectedDiseaseLabel = useMemo(() => {
    if (filters.disease) return filters.disease;
    return data?.selectedDiseaseLabel ?? '대표 감염병 자동 선택';
  }, [data?.selectedDiseaseLabel, filters.disease]);

  if (!layerVisible) return null;

  return (
    <aside className="hidden xl:block h-[calc(100vh-2rem)] w-[420px] pointer-events-auto">
      <GlassCard
        title="Infectious Distribution"
        subtitle={`${data?.yearLabel ?? '최신'} • ${data?.metricLabel ?? '발생건수'}`}
        rightSlot={(
          <button
            type="button"
            onClick={() => toggleLayer('health-infectious-distribution')}
            className="rounded-lg border border-orange-400/18 bg-orange-500/10 p-1.5 text-orange-100 transition-colors hover:border-orange-300/35 hover:bg-orange-500/16"
            aria-label="Close infectious distribution panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
        className="flex h-full min-h-0 flex-col overflow-hidden border-orange-500/20 bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.18),_rgba(120,53,15,0.14)_28%,_rgba(10,15,20,0.92)_72%)] shadow-[0_0_42px_rgba(249,115,22,0.15)]"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div className="rounded-[1.25rem] border border-orange-400/18 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="inline-flex items-center rounded-full border border-orange-400/18 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.24em] text-orange-100">
                  {data?.metricLabel ?? '발생건수'}
                </div>
                <div>
                  <h3 className="text-[1.1rem] font-semibold tracking-[0.01em] text-orange-50">
                    감염병 상세 분포
                  </h3>
                  <p className="mt-1 text-[11px] tracking-[0.16em] text-orange-200/75">
                    {data?.yearLabel ?? (meta.selectedYear ? `${meta.selectedYear}년` : '최신')} · {selectedDiseaseLabel}
                  </p>
                </div>
              </div>
              <div className="rounded-full border border-orange-400/18 bg-orange-500/10 px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-orange-100">
                {isFetching ? 'SYNCING' : 'LIVE'}
              </div>
            </div>
          </div>

          {!data ? (
            <div className="flex h-48 items-center justify-center rounded-[1.25rem] border border-dashed border-orange-500/18 bg-black/20 px-5 text-center text-[11px] tracking-[0.16em] text-orange-200/70">
              {isFetching ? '감염병 상세 분포 데이터 로드 중...' : '좌측 LayerPanel에서 감염병 상세 분포를 켜고 조건을 선택하세요.'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <SummaryCard
                  label="TOP DISEASE"
                  value={data.summary.topDiseaseName ?? '-'}
                  subLabel={
                    data.summary.topDiseaseValue === null
                      ? '최상위 감염병 없음'
                      : `${formatMetricValue(data.summary.topDiseaseValue, data.metric)}${getMetricUnit(data.metric)}`
                  }
                />
                <SummaryCard
                  label="SELECTED"
                  value={data.summary.selectedDiseaseName ?? '-'}
                  subLabel={
                    data.summary.selectedDiseaseValue === null
                      ? '선택 감염병 값 없음'
                      : `${formatMetricValue(data.summary.selectedDiseaseValue, data.metric)}${getMetricUnit(data.metric)}`
                  }
                />
                <SummaryCard
                  label="PEAK AGE"
                  value={data.summary.peakAgeLabel ?? '-'}
                  subLabel={
                    data.summary.peakAgeValue === null
                      ? '연령 분포 없음'
                      : `${formatMetricValue(data.summary.peakAgeValue, data.metric)}${getMetricUnit(data.metric)}`
                  }
                />
                <SummaryCard
                  label="DEATHS"
                  value={
                    data.summary.deathTotal === null
                      ? '-'
                      : `${formatMetricValue(data.summary.deathTotal, 'count', true)}건`
                  }
                  subLabel={data.summary.deathTopDiseaseName ? `최다: ${data.summary.deathTopDiseaseName}` : '사망 현황 없음'}
                />
              </div>

              <TopDiseasesSection
                key={`${data.year}-${data.metric}-${data.selectedDisease ?? 'auto'}`}
                rows={data.topDiseases}
                metric={data.metric}
              />

              <AgeBreakdownSection
                key={`${data.year}-${data.metric}-${data.selectedDisease ?? 'auto'}-age`}
                rows={data.ageBreakdown}
                metric={data.metric}
              />

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-orange-100/90">
                  <Users className="h-3.5 w-3.5" />
                  성별
                </div>
                <BarList
                  rows={data.genderBreakdown}
                  metric={data.metric}
                  emptyText="선택 감염병의 성별 분포가 없습니다."
                />
              </section>

              <DeathBreakdownSection
                key={`${data.year}-${data.selectedDisease ?? 'auto'}-death`}
                rows={data.deathBreakdown}
              />

              <div className="flex items-center justify-between rounded-xl border border-orange-400/18 bg-orange-500/8 px-3 py-2 text-[10px] tracking-[0.14em] text-orange-100/80">
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="h-3 w-3" />
                  {data.sourceLabel}
                </span>
                <span>{meta.updatedAt ? new Date(meta.updatedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '동기화 대기'}</span>
              </div>
            </>
          )}
        </div>
      </GlassCard>
    </aside>
  );
}
