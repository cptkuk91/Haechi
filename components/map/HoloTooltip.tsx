'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipData {
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  fields: { label: string; value: string }[];
}

interface HoloTooltipProps {
  data: TooltipData | null;
}

export default function HoloTooltip({ data }: HoloTooltipProps) {
  return (
    <AnimatePresence>
      {data && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.15 }}
          className="fixed z-[100] pointer-events-none"
          style={{ left: data.x + 16, top: data.y - 10 }}
        >
          <div className="bg-[#0a0f14]/95 backdrop-blur-md border border-cyan-500/40 rounded-lg px-3 py-2 min-w-[160px] shadow-[0_0_20px_rgba(0,240,255,0.15)]">
            {/* 상단 바 */}
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,240,255,0.8)]" />
              <span className="text-[10px] font-mono text-cyan-300 tracking-wider font-bold">
                {data.title}
              </span>
            </div>

            {data.subtitle && (
              <p className="text-[9px] font-mono text-cyan-600 mb-1.5 tracking-wider">
                {data.subtitle}
              </p>
            )}

            {/* 데이터 필드 */}
            <div className="space-y-0.5 border-t border-cyan-800/30 pt-1.5">
              {data.fields.map((field) => (
                <div key={field.label} className="flex justify-between gap-4">
                  <span className="text-[9px] font-mono text-cyan-700 tracking-wider">
                    {field.label}
                  </span>
                  <span className="text-[9px] font-mono text-cyan-400 tracking-wider">
                    {field.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 포인터 라인 */}
          <div className="absolute left-0 top-3 -translate-x-full w-3 h-[1px] bg-gradient-to-l from-cyan-500/60 to-transparent" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
