'use client';

import { useState, useEffect } from 'react';
import { Github } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';

const KST_TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatKstTimestamp(date: Date): string {
  const parts = KST_TIME_FORMATTER.formatToParts(date);
  const lookup = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}:${lookup.second} KST`;
}

export default function HudHeader() {
  const [time, setTime] = useState('');
  const camera = useAppStore((s) => s.camera);
  const activeDomainCount = useAppStore(
    (s) => new Set(Object.values(s.layers).filter((l) => l.visible).map((l) => l.domain)).size
  );

  useEffect(() => {
    const updateTime = () => {
      setTime(formatKstTimestamp(new Date()));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="absolute top-0 left-0 right-0 px-6 py-4 flex justify-between items-start z-[70] pointer-events-none">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] animate-pulse" />
          <h1 className="text-2xl font-bold tracking-[0.3em] text-white drop-shadow-[0_0_10px_rgba(0,0,0,0.5)]">
            HAECHI
          </h1>
        </div>
        <div className="text-[9px] mt-2 text-cyan-700/80 tracking-widest uppercase space-y-0.5">
          <p>NATIONAL INTEGRATED CONTROL</p>
          <p>
            LAT {camera.latitude.toFixed(3)} LNG {camera.longitude.toFixed(3)} Z{camera.zoom.toFixed(1)}
          </p>
        </div>
      </div>

      <div className="text-right text-[9px] text-cyan-700/80 tracking-widest uppercase space-y-0.5">
        <div className="flex items-center justify-end gap-2 text-red-500 mb-1">
          <a
            href="https://github.com/cptkuk91"
            target="_blank"
            rel="noreferrer"
            aria-label="Open GitHub profile"
            className="pointer-events-auto mr-1 inline-flex items-center justify-center rounded-md border border-cyan-400/25 bg-cyan-500/5 p-1.5 text-cyan-300/80 transition-colors hover:border-cyan-300/60 hover:bg-cyan-400/10 hover:text-cyan-100"
          >
            <Github className="h-4 w-4" />
          </a>
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse" />
          <p className="font-mono">{time}</p>
        </div>
        <p>SYS: ONLINE</p>
        <div className="flex items-center justify-end gap-1.5 mt-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]" />
          <span className="text-green-500/80">{activeDomainCount} DOMAINS ACTIVE</span>
        </div>
      </div>
    </header>
  );
}
