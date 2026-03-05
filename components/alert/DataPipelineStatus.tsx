'use client';

import { WifiOff } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';

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
  const pipelineErrors = useAppStore((s) => s.pipelineErrors);

  if (pipelineErrors.size === 0) return null;

  const failedLabels = [...pipelineErrors].map((d) => DOMAIN_LABELS[d] || d);

  return (
    <div className="absolute bottom-16 left-4 z-[70] pointer-events-auto">
      <div className="flex items-center gap-2 rounded-xl border border-red-900/40 bg-[#0a0f14]/90 px-3 py-2 backdrop-blur-md">
        <WifiOff className="h-3.5 w-3.5 text-red-400 animate-pulse" />
        <span className="text-[9px] tracking-[0.15em] text-red-400 font-mono uppercase">
          API Fault: {failedLabels.join(', ')}
        </span>
      </div>
    </div>
  );
}
