'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

export default function GlassCard({
  title,
  subtitle,
  rightSlot,
  className,
  children,
  ...props
}: GlassCardProps) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-cyan-900/40 bg-[#0a0f14]/80 p-4 shadow-[0_0_30px_rgba(8,145,178,0.15)] backdrop-blur-md',
        className
      )}
      {...props}
    >
      {(title || subtitle || rightSlot) && (
        <header className="mb-3 flex items-start justify-between gap-3 border-b border-cyan-900/30 pb-3">
          <div>
            {title ? (
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-400">{title}</h3>
            ) : null}
            {subtitle ? (
              <p className="mt-1 text-[10px] tracking-wider text-cyan-700">{subtitle}</p>
            ) : null}
          </div>
          {rightSlot}
        </header>
      )}
      {children}
    </section>
  );
}
