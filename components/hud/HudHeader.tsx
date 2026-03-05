'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';

export default function HudHeader() {
  const [time, setTime] = useState('');
  const camera = useAppStore((s) => s.camera);
  const activeDomainCount = useAppStore(
    (s) => new Set(Object.values(s.layers).filter((l) => l.visible).map((l) => l.domain)).size
  );

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toISOString().replace('T', ' ').substring(0, 19) + 'Z');
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
            TENMO
          </h1>
        </div>
        <div className="text-[9px] mt-2 text-cyan-700/80 tracking-widest uppercase space-y-0.5">
          <p>3D INTEGRATED CONTROL // KOREA</p>
          <p>
            LAT {camera.latitude.toFixed(3)} LNG {camera.longitude.toFixed(3)} Z{camera.zoom.toFixed(1)}
          </p>
        </div>
      </div>

      <div className="text-right text-[9px] text-cyan-700/80 tracking-widest uppercase space-y-0.5">
        <div className="flex items-center justify-end gap-2 text-red-500 mb-1">
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
