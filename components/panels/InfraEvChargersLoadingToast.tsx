'use client';

import { AnimatePresence, motion } from 'motion/react';
import { BatteryCharging, LoaderCircle, PlugZap } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { getInfraEvChargerFeatureLimitForZoom } from '@/lib/infra-ev-chargers';

export function InfraEvChargersLoadingToast() {
  const fetchCount = useIsFetching({ queryKey: ['infra', 'ev-chargers'] });
  const layerVisible = useAppStore((s) => Boolean(s.layers['infra-ev-chargers']?.visible));
  const zoom = useAppStore((s) => s.camera.zoom);
  const featureLimit = getInfraEvChargerFeatureLimitForZoom(zoom);

  const isVisible = layerVisible && fetchCount > 0;

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key="infra-ev-chargers-loading"
          initial={{ opacity: 0, x: 18, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          exit={{ opacity: 0, x: 18, y: 8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="pointer-events-none w-full"
        >
          <div className="overflow-hidden rounded-2xl border border-orange-400/25 bg-[#091018]/92 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: 'linear' }}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-orange-300/25 bg-orange-400/10"
                >
                  <LoaderCircle className="h-3.5 w-3.5 text-orange-100" />
                </motion.div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-orange-100">
                    EV Charger Sync
                  </p>
                  <p className="mt-0.5 text-[11px] text-orange-200">
                    전기차 충전소 데이터 로드 중...
                  </p>
                </div>
              </div>
              <BatteryCharging className="h-4 w-4 text-orange-300/75" />
            </div>

            <p className="text-[10px] leading-relaxed text-orange-300/90">
              {`현재 줌 기준으로 상위 ${featureLimit.toLocaleString('ko-KR')}개 충전소만 우선 표시`}
            </p>

            <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.18em] text-orange-400/80">
              <span className="inline-flex items-center gap-1">
                <PlugZap className="h-3 w-3" />
                Infra / Charger
              </span>
              <span>SYNCING</span>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-orange-950/70">
              <motion.div
                className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(249,115,22,0.12),rgba(253,186,116,0.92),rgba(251,146,60,0.2))]"
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
