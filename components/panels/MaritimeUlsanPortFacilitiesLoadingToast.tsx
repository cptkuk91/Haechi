'use client';

import { AnimatePresence, motion } from 'motion/react';
import { LoaderCircle, MapPinned, Warehouse } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';

export function MaritimeUlsanPortFacilitiesLoadingToast() {
  const fetchCount = useIsFetching({ queryKey: ['maritime', 'ulsan-port-facilities'] });
  const layerVisible = useAppStore((s) => Boolean(s.layers['maritime-ulsan-port-facilities']?.visible));
  const isVisible = layerVisible && fetchCount > 0;

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key="maritime-ulsan-port-facilities-loading"
          initial={{ opacity: 0, x: 18, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 18, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none w-full"
        >
          <div className="overflow-hidden rounded-2xl border border-rose-400/25 bg-[#08111a]/92 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-rose-300/25 bg-rose-400/10"
                >
                  <LoaderCircle className="h-3.5 w-3.5 text-rose-100" />
                </motion.div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-rose-100">
                    Ulsan Port Sync
                  </p>
                  <p className="mt-0.5 text-[11px] text-rose-200">
                    울산항 항만시설 좌표 데이터 로드 중...
                  </p>
                </div>
              </div>
              <Warehouse className="h-4 w-4 text-rose-300/75" />
            </div>

            <p className="text-[10px] leading-relaxed text-rose-300/90">
              울산항 부두와 부이 시설 포인트를 지도에 동기화합니다.
            </p>

            <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.18em] text-rose-400/80">
              <span className="inline-flex items-center gap-1">
                <MapPinned className="h-3 w-3" />
                Maritime / Ulsan Port
              </span>
              <span>SYNCING</span>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rose-950/70">
              <motion.div
                className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(251,113,133,0.12),rgba(253,164,175,0.92),rgba(244,63,94,0.2))]"
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
