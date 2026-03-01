'use client';

import { useMemo } from 'react';
import { WifiOff } from 'lucide-react';
import {
  useTrafficData,
  useWeatherData,
  useDisasterData,
  useInfraData,
  useCrimeData,
  useHealthData,
  useVulnerableData,
} from '@/hooks/usePublicAPI';

const DOMAIN_LABELS: Record<string, string> = {
  traffic: '교통',
  weather: '기상',
  disaster: '재난',
  infra: '인프라',
  crime: '치안',
  health: '보건',
  vulnerable: '약자',
};

export default function DataPipelineStatus() {
  const queries = [
    { domain: 'traffic', ...useTrafficData() },
    { domain: 'weather', ...useWeatherData() },
    { domain: 'disaster', ...useDisasterData() },
    { domain: 'infra', ...useInfraData() },
    { domain: 'crime', ...useCrimeData() },
    { domain: 'health', ...useHealthData() },
    { domain: 'vulnerable', ...useVulnerableData() },
  ];

  const failedDomains = useMemo(
    () => queries.filter((q) => q.isError).map((q) => DOMAIN_LABELS[q.domain] || q.domain),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.isError).join(',')]
  );

  if (failedDomains.length === 0) return null;

  return (
    <div className="absolute bottom-16 left-4 z-[70] pointer-events-auto">
      <div className="flex items-center gap-2 rounded-xl border border-red-900/40 bg-[#0a0f14]/90 px-3 py-2 backdrop-blur-md">
        <WifiOff className="h-3.5 w-3.5 text-red-400 animate-pulse" />
        <span className="text-[9px] tracking-[0.15em] text-red-400 font-mono uppercase">
          API Fault: {failedDomains.join(', ')}
        </span>
      </div>
    </div>
  );
}
