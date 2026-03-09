'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Anchor, LoaderCircle, MapPinned } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { getMaritimeBuoyFeatureLimitForZoom } from '@/lib/maritime-buoys';

export function MaritimeBuoyLoadingToast() {
  const maritimeBuoyFetchCount = useIsFetching({ queryKey: ['maritime', 'buoys'] });
  const layerVisible = useAppStore((s) => Boolean(s.layers['maritime-buoy-locations']?.visible));
  const zoom = useAppStore((s) => s.camera.zoom);
  const featureLimit = getMaritimeBuoyFeatureLimitForZoom(zoom);

  const isVisible = layerVisible && maritimeBuoyFetchCount > 0;

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key="maritime-buoy-loading"
          initial={{ opacity: 0, x: 18, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 18, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none w-full"
        >
          <div className="overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#08111a]/92 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-400/10"
                >
                  <LoaderCircle className="h-3.5 w-3.5 text-cyan-100" />
                </motion.div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-cyan-100">
                    Maritime Sync
                  </p>
                  <p className="mt-0.5 text-[11px] text-cyan-200">
                    항로표지 위치 데이터 로드 중...
                  </p>
                </div>
              </div>
              <Anchor className="h-4 w-4 text-cyan-300/75" />
            </div>

            <p className="text-[10px] leading-relaxed text-cyan-300/90">
              {`현재 줌 기준으로 상위 ${featureLimit.toLocaleString('ko-KR')}개 좌표만 우선 표시`}
            </p>

            <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.18em] text-cyan-400/80">
              <span className="inline-flex items-center gap-1">
                <MapPinned className="h-3 w-3" />
                Maritime / Buoy
              </span>
              <span>SYNCING</span>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyan-950/70">
              <motion.div
                className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(103,232,249,0.12),rgba(125,211,252,0.92),rgba(6,182,212,0.2))]"
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
