'use client';

import { useMemo } from 'react';

interface MiniChartProps {
  values: number[];
  stroke?: string;
  height?: number;
}

export default function MiniChart({ values, stroke = '#00f0ff', height = 44 }: MiniChartProps) {
  const path = useMemo(() => {
    if (values.length < 2) return '';
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 100 - ((value - min) / range) * 100;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [values]);

  return (
    <div className="h-11 w-full overflow-hidden rounded-lg border border-cyan-900/30 bg-cyan-950/25">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="mini-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {path ? (
          <>
            <path d={`${path} L 100 100 L 0 100 Z`} fill="url(#mini-chart-fill)" />
            <path d={path} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
          </>
        ) : null}
      </svg>
      <span className="sr-only">Mini trend chart with {values.length} points and {height}px height.</span>
    </div>
  );
}
