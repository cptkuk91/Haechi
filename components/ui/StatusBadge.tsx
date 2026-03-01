'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BadgeTone = 'default' | 'info' | 'warning' | 'critical' | 'active';

interface StatusBadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  default: 'border-cyan-900/40 bg-cyan-950/30 text-cyan-400',
  info: 'border-blue-500/40 bg-blue-950/30 text-blue-300',
  warning: 'border-amber-500/40 bg-amber-950/30 text-amber-300',
  critical: 'border-red-500/50 bg-red-950/35 text-red-300',
  active: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300',
};

export default function StatusBadge({ tone = 'default', children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.2em]',
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
