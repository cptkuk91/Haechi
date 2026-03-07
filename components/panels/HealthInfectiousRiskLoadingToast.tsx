'use client';

import { AnimatePresence, motion } from 'motion/react';
import { LoaderCircle, Waves } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';

function formatMetricLabel(metric: 'incidence' | 'count'): string {
  return metric === 'count' ? '발생건수' : '10만명당 발생률';
}

function formatDiseaseLabel(disease: string | null, options: Array<{ value: string; label: string }>): string {
  if (!disease) return '전체 감염병';
  return options.find((option) => option.value === disease)?.label ?? disease;
}

function formatYearLabel(year: number | null, selectedYear: number | null): string {
  if (typeof year === 'number') return `${year}년`;
  if (typeof selectedYear === 'number') return `최신 ${selectedYear}년`;
  return '최신 연도';
}

export function HealthInfectiousRiskLoadingToast() {
  const healthRiskFetchCount = useIsFetching({ queryKey: ['health', 'infectious-risk-sido'] });
  const filters = useAppStore((s) => s.healthInfectiousRiskFilters);
  const meta = useAppStore((s) => s.healthInfectiousRiskMeta);
  const layerVisible = useAppStore((s) => Boolean(s.layers['health-infectious-risk-sido']?.visible));

  const isVisible = layerVisible && healthRiskFetchCount > 0;

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key="health-infectious-risk-loading"
          initial={{ opacity: 0, x: 18, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 18, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none absolute left-0 right-0 -top-16 z-[75] xl:left-auto xl:right-[calc(100%+0.75rem)] xl:top-3 xl:w-[280px]"
        >
          <div className="overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#08111a]/92 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-400/10"
                >
                  <LoaderCircle className="h-3.5 w-3.5 text-cyan-200" />
                </motion.div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-cyan-100">
                    Infectious Sync
                  </p>
                  <p className="mt-0.5 text-[11px] text-cyan-300">
                    시도별 감염 위험도 로드 중...
                  </p>
                </div>
              </div>
              <Waves className="h-4 w-4 text-cyan-400/70" />
            </div>

            <p className="text-[10px] leading-relaxed text-cyan-400/90">
              {`${formatYearLabel(filters.year, meta.selectedYear)} · ${formatDiseaseLabel(filters.disease, meta.diseaseOptions)} · ${formatMetricLabel(filters.metric)}`}
            </p>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cyan-950/70">
              <motion.div
                className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(103,232,249,0.12),rgba(125,211,252,0.92),rgba(56,189,248,0.2))]"
                animate={{ x: ['-120%', '220%'] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
