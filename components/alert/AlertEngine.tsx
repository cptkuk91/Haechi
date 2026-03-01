'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BellRing, MapPinned, X } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import StatusBadge from '@/components/ui/StatusBadge';
import type { AlertSeverity } from '@/types/domain';

function playAlertTone(severity: AlertSeverity): void {
  if (typeof window === 'undefined') return;

  try {
    const AudioContextImpl = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextImpl) return;

    const audioContext = new AudioContextImpl();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    const toneBySeverity: Record<AlertSeverity, number> = {
      info: 520,
      warning: 760,
      critical: 980,
    };

    oscillator.type = severity === 'critical' ? 'sawtooth' : 'triangle';
    oscillator.frequency.value = toneBySeverity[severity];
    gainNode.gain.value = severity === 'critical' ? 0.055 : 0.03;

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + (severity === 'critical' ? 0.28 : 0.16));

    oscillator.onended = () => {
      void audioContext.close();
    };
  } catch {
    // 브라우저 autoplay 정책으로 실패할 수 있어 무시
  }
}

export default function AlertEngine() {
  const alerts = useAppStore((s) => s.alerts);
  const dismissAlert = useAppStore((s) => s.dismissAlert);
  const flyTo = useAppStore((s) => s.flyTo);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);

  const seenAlertIds = useRef<Set<string>>(new Set());
  const dismissTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activeAlerts = alerts.filter((alert) => !alert.dismissed).slice(0, 4);

  useEffect(() => {
    for (const alert of activeAlerts) {
      if (!seenAlertIds.current.has(alert.id)) {
        seenAlertIds.current.add(alert.id);
        playAlertTone(alert.severity);
      }

      if (alert.severity !== 'critical' && !dismissTimers.current[alert.id]) {
        dismissTimers.current[alert.id] = setTimeout(() => {
          dismissAlert(alert.id);
          delete dismissTimers.current[alert.id];
        }, 9500);
      }
    }

    return () => {
      for (const [id, timer] of Object.entries(dismissTimers.current)) {
        if (!activeAlerts.find((alert) => alert.id === id)) {
          clearTimeout(timer);
          delete dismissTimers.current[id];
        }
      }
    };
  }, [activeAlerts, dismissAlert]);

  useEffect(() => {
    return () => {
      Object.values(dismissTimers.current).forEach((timer) => clearTimeout(timer));
      dismissTimers.current = {};
    };
  }, []);

  return (
    <div
      className={`pointer-events-none absolute top-4 z-[90] w-[360px] space-y-2 transition-all ${
        rightPanelOpen ? 'right-[338px]' : 'right-4'
      }`}
    >
      <AnimatePresence>
        {activeAlerts.map((alert) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            className="pointer-events-auto rounded-xl border border-cyan-900/40 bg-[#071018]/95 p-3 shadow-[0_0_30px_rgba(0,0,0,0.45)] backdrop-blur-md"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <BellRing className="h-4 w-4 shrink-0 text-cyan-300" />
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">{alert.title}</p>
              </div>
              <button
                onClick={() => dismissAlert(alert.id)}
                className="rounded-md border border-cyan-900/40 p-1 text-cyan-600 transition-colors hover:border-cyan-700/60 hover:text-cyan-300"
                aria-label={`Dismiss alert ${alert.title}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mb-2 flex items-center justify-between">
              <StatusBadge tone={alert.severity}>{alert.severity}</StatusBadge>
              <span className="text-[9px] tracking-wider text-cyan-700">
                {new Date(alert.timestamp).toLocaleTimeString('ko-KR', { hour12: false })}
              </span>
            </div>

            <p className="text-[11px] leading-relaxed text-cyan-400">{alert.message}</p>

            {alert.coordinates ? (
              <button
                onClick={() => flyTo(alert.coordinates![1], alert.coordinates![0], 11)}
                className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-900/40 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-500 transition-colors hover:border-cyan-700/60 hover:text-cyan-300"
              >
                <MapPinned className="h-3.5 w-3.5" /> Focus
              </button>
            ) : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
