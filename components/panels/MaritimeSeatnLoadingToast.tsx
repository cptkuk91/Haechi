'use client';

import { AnimatePresence, motion } from 'motion/react';
import { LoaderCircle, MapPinned, ShieldAlert } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';

export function MaritimeSeatnLoadingToast() {
  const maritimeSeatnFetchCount = useIsFetching({ queryKey: ['maritime', 'seatn', '04'] });
  const layerVisible = useAppStore((s) => Boolean(s.layers['maritime-seatn-zones']?.visible));

  const isVisible = layerVisible && maritimeSeatnFetchCount > 0;

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key="maritime-seatn-loading"
          initial={{ opacity: 0, x: 18, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 18, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none w-full"
        >
          <div className="overflow-hidden rounded-2xl border border-amber-400/25 bg-[#08111a]/92 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/25 bg-amber-400/10"
                >
                  <LoaderCircle className="h-3.5 w-3.5 text-amber-100" />
                </motion.div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-amber-100">
                    Seatn Sync
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-200">
                    해상사격훈련구역 데이터 로드 중...
                  </p>
                </div>
              </div>
              <ShieldAlert className="h-4 w-4 text-amber-300/75" />
            </div>

            <p className="text-[10px] leading-relaxed text-amber-300/90">
              전국 해군 훈련구역 24개를 한 번에 동기화합니다.
            </p>

            <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.18em] text-amber-400/80">
              <span className="inline-flex items-center gap-1">
                <MapPinned className="h-3 w-3" />
                Maritime / Training Zones
              </span>
              <span>SYNCING</span>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-950/70">
              <motion.div
                className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(251,191,36,0.12),rgba(253,230,138,0.92),rgba(245,158,11,0.2))]"
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
