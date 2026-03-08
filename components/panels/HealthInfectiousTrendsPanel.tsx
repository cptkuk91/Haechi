'use client';

import { useMemo } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { Activity, Globe2, PanelRightClose, TrendingUp, UserRoundSearch } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import { useAppStore, type HealthInfectiousTrendPoint } from '@/stores/app-store';

function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return value.toLocaleString('ko-KR');
}

function formatChangePct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '변화 없음';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function getTrendChartWidth(pointCount: number, periodType: 'year' | 'month' | 'week'): number {
  if (periodType === 'week') return Math.max(320, pointCount * 18);
  if (periodType === 'month') return Math.max(320, pointCount * 24);
  return 320;
}

function buildPolylinePoints(values: number[], width: number, height: number): string {
  const maxValue = Math.max(...values, 1);
  const safeValues = values.length === 1 ? [values[0], values[0]] : values;

  return safeValues
    .map((value, index) => {
      const x = safeValues.length === 1 ? width / 2 : (index / (safeValues.length - 1)) * width;
      const y = height - (value / maxValue) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function TrendLineChart({
  points,
  periodType,
}: {
  points: HealthInfectiousTrendPoint[];
  periodType: 'year' | 'month' | 'week';
}) {
  if (points.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-cyan-900/30 bg-cyan-950/15 text-[10px] tracking-[0.18em] text-cyan-700">
        TREND DATA EMPTY
      </div>
    );
  }

  const width = getTrendChartWidth(points.length, periodType);
  const height = 104;
  const values = points.map((point) => point.total);
  const polyline = buildPolylinePoints(values, width, height);
  const isScrollable = width > 320;

  return (
    <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 p-3">
      <div className={isScrollable ? 'overflow-x-auto pb-1' : ''}>
        <div style={isScrollable ? { width: `${width}px` } : undefined} className={isScrollable ? 'min-w-[320px]' : ''}>
          <svg viewBox={`0 0 ${width} ${height + 8}`} className="h-32 w-full overflow-visible">
            <defs>
              <linearGradient id="infectiousTrendStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1="0"
                x2={width}
                y1={(height * ratio).toFixed(2)}
                y2={(height * ratio).toFixed(2)}
                stroke="rgba(34,211,238,0.12)"
                strokeDasharray="4 6"
                strokeWidth="1"
              />
            ))}
            <polyline
              fill="none"
              stroke="url(#infectiousTrendStroke)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polyline}
            />
          </svg>
          <div className="mt-2 flex items-center justify-between text-[9px] tracking-[0.18em] text-cyan-500/90">
            <span>{points[0]?.period ?? '-'}</span>
            <span>{points.at(-1)?.period ?? '-'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownRows({
  rows,
  segments,
}: {
  rows: HealthInfectiousTrendPoint[];
  segments: Array<{
    key: 'domestic' | 'overseas' | 'patient' | 'suspected' | 'carrier';
    label: string;
    colorClass: string;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-cyan-900/30 bg-cyan-950/15 px-3 py-4 text-[10px] tracking-[0.18em] text-cyan-700">
        CURRENT DATA EMPTY
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const total = Math.max(row.total, 1);
        return (
          <div key={row.period} className="rounded-xl border border-cyan-900/25 bg-cyan-950/18 px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="text-[10px] tracking-[0.12em] text-cyan-200">{row.period}</span>
              <span className="text-[10px] text-cyan-400">{formatCount(row.total)}건</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-cyan-950/80">
              {segments.map((segment) => {
                const value = row[segment.key] ?? 0;
                const widthPct = Math.max(0, (value / total) * 100);
                if (widthPct <= 0) return null;
                return (
                  <div
                    key={segment.key}
                    className={segment.colorClass}
                    style={{ width: `${widthPct}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-cyan-500/90">
              {segments.map((segment) => (
                <span key={segment.key}>
                  {segment.label} {formatCount(row[segment.key])}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HealthInfectiousTrendsPanel() {
  const layerVisible = useAppStore((s) => s.layers['health-infectious-trends']?.visible ?? false);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const filters = useAppStore((s) => s.healthInfectiousTrendFilters);
  const meta = useAppStore((s) => s.healthInfectiousTrendMeta);
  const data = useAppStore((s) => s.healthInfectiousTrendData);
  const isFetching = useIsFetching({ queryKey: ['health', 'infectious-trends'] }) > 0;

  const diseaseLabel = useMemo(() => {
    if (!filters.disease) return '전체 감염병';
    return meta.diseaseOptions.find((option) => option.value === filters.disease)?.label ?? filters.disease;
  }, [filters.disease, meta.diseaseOptions]);

  const recentRegionRows = useMemo(() => {
    return (data?.regionSeries ?? []).slice(-5).reverse();
  }, [data?.regionSeries]);
  const recentPatientRows = useMemo(() => {
    return (data?.patientSeries ?? []).slice(-5).reverse();
  }, [data?.patientSeries]);

  if (!layerVisible) return null;

  return (
    <aside className="hidden xl:block w-[420px] max-h-[calc(100vh-2rem)] pointer-events-auto">
      <GlassCard
        title="Infectious Trends"
        subtitle={`${data?.periodTypeLabel ?? '기간별'} • ${diseaseLabel}`}
        rightSlot={(
          <button
            type="button"
            onClick={() => toggleLayer('health-infectious-trends')}
            className="rounded-lg border border-emerald-400/18 bg-emerald-500/10 p-1.5 text-emerald-100 transition-colors hover:border-emerald-300/35 hover:bg-emerald-500/16"
            aria-label="Close infectious trends panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
        className="h-full overflow-hidden border-emerald-500/20 bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.18),_rgba(6,78,59,0.12)_24%,_rgba(10,15,20,0.92)_72%)] shadow-[0_0_42px_rgba(20,184,166,0.16)]"
      >
        <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
          <div className="rounded-[1.25rem] border border-emerald-400/18 bg-black/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="inline-flex items-center rounded-full border border-emerald-400/18 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.24em] text-emerald-100">
                  {data?.periodTypeLabel ?? '기간별'}
                </div>
                <div>
                  <h3 className="text-[1.1rem] font-semibold tracking-[0.01em] text-emerald-50">
                    감염병 추세 분석
                  </h3>
                  <p className="mt-1 text-[11px] tracking-[0.16em] text-emerald-200/75">
                    {`${filters.startYear}년 ~ ${filters.endYear}년`}
                  </p>
                </div>
              </div>
              <div className="rounded-full border border-emerald-400/18 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-emerald-100">
                {isFetching ? 'SYNCING' : 'LIVE'}
              </div>
            </div>
          </div>

          {!data ? (
            <div className="flex h-48 items-center justify-center rounded-[1.25rem] border border-dashed border-emerald-500/18 bg-black/20 px-5 text-center text-[11px] tracking-[0.16em] text-emerald-200/70">
              {isFetching ? '감염 추세 데이터 로드 중...' : '좌측 LayerPanel에서 기간별 감염 추세를 켜고 조건을 선택하세요.'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                  <p className="text-[9px] tracking-[0.2em] text-cyan-800">LATEST</p>
                  <p className="mt-1 text-[13px] font-semibold text-cyan-200">
                    {formatCount(data.summary.latestTotal)}
                  </p>
                  <p className="mt-1 text-[9px] text-cyan-500">{data.summary.latestPeriod ?? '-'}</p>
                </div>
                <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                  <p className="text-[9px] tracking-[0.2em] text-cyan-800">CHANGE</p>
                  <p className="mt-1 text-[13px] font-semibold text-cyan-200">
                    {formatChangePct(data.summary.changePct)}
                  </p>
                  <p className="mt-1 text-[9px] text-cyan-500">
                    {data.summary.previousPeriod ?? '이전 구간 없음'}
                  </p>
                </div>
                <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                  <p className="text-[9px] tracking-[0.2em] text-cyan-800">PEAK</p>
                  <p className="mt-1 text-[13px] font-semibold text-cyan-200">
                    {formatCount(data.summary.peakValue)}
                  </p>
                  <p className="mt-1 text-[9px] text-cyan-500">{data.summary.peakPeriod ?? '-'}</p>
                </div>
              </div>

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-emerald-100/90">
                  <TrendingUp className="h-3.5 w-3.5" />
                  전체 추세
                </div>
                <TrendLineChart points={data.overallSeries} periodType={data.periodType} />
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-emerald-100/90">
                  <Globe2 className="h-3.5 w-3.5" />
                  감염지역별
                </div>
                <BreakdownRows
                  rows={recentRegionRows}
                  segments={[
                    { key: 'domestic', label: '국내', colorClass: 'bg-emerald-400/80' },
                    { key: 'overseas', label: '국외', colorClass: 'bg-amber-300/80' },
                  ]}
                />
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-emerald-100/90">
                  <UserRoundSearch className="h-3.5 w-3.5" />
                  환자분류별
                </div>
                <BreakdownRows
                  rows={recentPatientRows}
                  segments={[
                    { key: 'patient', label: '환자', colorClass: 'bg-cyan-300/80' },
                    { key: 'suspected', label: '의사환자', colorClass: 'bg-violet-300/80' },
                    { key: 'carrier', label: '병원체보유자', colorClass: 'bg-rose-300/80' },
                  ]}
                />
              </section>

              <div className="flex items-center justify-between rounded-xl border border-emerald-400/18 bg-emerald-500/8 px-3 py-2 text-[10px] tracking-[0.14em] text-emerald-100/80">
                <span className="inline-flex items-center gap-1.5"><Activity className="h-3 w-3" />{data.sourceLabel}</span>
                <span>{meta.updatedAt ? new Date(meta.updatedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '동기화 대기'}</span>
              </div>
            </>
          )}
        </div>
      </GlassCard>
    </aside>
  );
}
