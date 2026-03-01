'use client';

import type { AlertSeverity } from '@/types/domain';
import StatusBadge from '@/components/ui/StatusBadge';

export interface FeedItem {
  id: string;
  title: string;
  description: string;
  timestampLabel: string;
  severity?: AlertSeverity;
}

interface DataFeedProps {
  items: FeedItem[];
  emptyMessage?: string;
}

export default function DataFeed({ items, emptyMessage = 'No live events' }: DataFeedProps) {
  if (items.length === 0) {
    return <p className="text-[10px] tracking-wider text-cyan-700">{emptyMessage}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-300">{item.title}</p>
            {item.severity ? <StatusBadge tone={item.severity}>{item.severity}</StatusBadge> : null}
          </div>
          <p className="line-clamp-2 text-[10px] leading-relaxed text-cyan-600">{item.description}</p>
          <p className="mt-1 text-[9px] tracking-wider text-cyan-800">{item.timestampLabel}</p>
        </li>
      ))}
    </ul>
  );
}
