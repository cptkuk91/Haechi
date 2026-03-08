'use client';

import { useState, useCallback } from 'react';
import { Globe, RotateCcw } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';

const LOCATIONS = [
  { name: 'Seoul', lat: 37.5665, lng: 126.978, zoom: 11 },
  { name: 'Busan', lat: 35.1796, lng: 129.0756, zoom: 11 },
  { name: 'Incheon', lat: 37.4563, lng: 126.7052, zoom: 11 },
  { name: 'Daegu', lat: 35.8714, lng: 128.6014, zoom: 11 },
  { name: 'Daejeon', lat: 36.3504, lng: 127.3845, zoom: 11 },
  { name: 'Gwangju', lat: 35.1595, lng: 126.8526, zoom: 11 },
  { name: 'Ulsan', lat: 35.5384, lng: 129.3114, zoom: 11 },
  { name: 'Jeju', lat: 33.4996, lng: 126.5312, zoom: 10 },
] as const;

export default function CityNavBar() {
  const [activeLocation, setActiveLocation] = useState('');
  const flyTo = useAppStore((s) => s.flyTo);
  const resetCamera = useAppStore((s) => s.resetCamera);

  const handleLocationClick = useCallback(
    (loc: (typeof LOCATIONS)[number]) => {
      setActiveLocation(loc.name);
      flyTo(loc.lat, loc.lng, loc.zoom);
    },
    [flyTo]
  );

  const handleResetView = useCallback(() => {
    setActiveLocation('');
    resetCamera();
  }, [resetCamera]);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[65] flex items-center gap-3 pointer-events-auto">
      <button
        onClick={handleResetView}
        className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all backdrop-blur-md ${
          !activeLocation
            ? 'bg-cyan-900/50 border-cyan-700/50 text-cyan-300'
            : 'bg-[#0a0f14]/80 border-cyan-900/30 text-cyan-700 hover:text-cyan-400 hover:border-cyan-700/40'
        }`}
      >
        <Globe className="w-3.5 h-3.5" />
        <span className="text-[10px] tracking-widest uppercase">Korea</span>
      </button>

      <div className="flex items-center gap-1 bg-[#0a0f14]/80 backdrop-blur-md border border-cyan-900/30 rounded-full p-1 px-2 overflow-x-auto no-scrollbar">
        {LOCATIONS.map((loc) => (
          <button
            key={loc.name}
            onClick={() => handleLocationClick(loc)}
            className={`px-3 py-1.5 rounded-full text-[10px] tracking-wider whitespace-nowrap transition-all ${
              activeLocation === loc.name
                ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700/50'
                : 'text-cyan-700 hover:text-cyan-400 hover:bg-cyan-950/30 border border-transparent'
            }`}
          >
            {loc.name}
          </button>
        ))}
      </div>

      <button
        onClick={handleResetView}
        className="p-2 bg-[#0a0f14]/80 backdrop-blur-md border border-cyan-900/30 rounded-full text-cyan-700 hover:text-cyan-400 hover:border-cyan-700/40 transition-all"
        title="Reset View"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
