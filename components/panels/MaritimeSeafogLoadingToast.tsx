'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Cloud, LoaderCircle, MapPinned } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';

export function MaritimeSeafogLoadingToast() {
  const maritimeSeafogFetchCount = useIsFetching({ queryKey: ['maritime', 'seafog'] });
  const layerVisible = useAppStore((s) => Boolean(s.layers['maritime-seafog-stations']?.visible));

  const isVisible = layerVisible && maritimeSeafogFetchCount > 0;

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key="maritime-seafog-loading"
          initial={{ opacity: 0, x: 18, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 18, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none w-full"
        >
          <div className="overflow-hidden rounded-2xl border border-sky-400/25 bg-[#08111a]/92 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-sky-300/25 bg-sky-400/10"
                >
                  <LoaderCircle className="h-3.5 w-3.5 text-sky-100" />
                </motion.div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-sky-100">
                    Sea Fog Sync
                  </p>
                  <p className="mt-0.5 text-[11px] text-sky-200">
                    해무관측소 최신 데이터 동기화 중...
                  </p>
                </div>
              </div>
              <Cloud className="h-4 w-4 text-sky-300/75" />
            </div>

            <p className="text-[10px] leading-relaxed text-sky-300/90">
              전국 항만 관측소 11개 지점을 최신 상태로 갱신합니다.
            </p>

            <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.18em] text-sky-400/80">
              <span className="inline-flex items-center gap-1">
                <MapPinned className="h-3 w-3" />
                Maritime / Sea Fog
              </span>
              <span>SYNCING</span>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-950/70">
              <motion.div
                className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(125,211,252,0.12),rgba(191,219,254,0.92),rgba(56,189,248,0.2))]"
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
