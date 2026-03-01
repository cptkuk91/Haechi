'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';

export default function WarningOverlay() {
  const alerts = useAppStore((s) => s.alerts);

  const criticalAlert = useMemo(() => {
    return alerts.find((alert) => !alert.dismissed && alert.severity === 'critical');
  }, [alerts]);

  return (
    <AnimatePresence>
      {criticalAlert ? (
        <motion.div
          key={criticalAlert.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 z-[80]"
        >
          <motion.div
            className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.15)_0%,rgba(160,0,0,0.02)_65%,transparent_100%)]"
            animate={{ opacity: [0.2, 0.42, 0.2] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-0 border-[3px] border-red-500/35"
            animate={{ opacity: [0.15, 0.5, 0.15] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-red-500/40 bg-red-950/50 px-4 py-1.5 backdrop-blur-sm">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-red-200">
              <ShieldAlert className="h-4 w-4" />
              Critical Alert
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
