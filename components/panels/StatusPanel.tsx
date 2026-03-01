'use client';

import { useMemo } from 'react';
import { ChevronRight, PanelRightClose, Radar, Siren, Target } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import StatusBadge from '@/components/ui/StatusBadge';
import DataFeed from '@/components/ui/DataFeed';
import MiniChart from '@/components/ui/MiniChart';
import { useAppStore } from '@/stores/app-store';
import { DOMAIN_REGISTRY } from '@/types/domain';
import { DOMAIN_ICONS } from '@/lib/domain-icons';

function formatValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value);
}

export default function StatusPanel() {
  const selectedObject = useAppStore((s) => s.selectedObject);
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);
  const layers = useAppStore((s) => s.layers);
  const alerts = useAppStore((s) => s.alerts);

  const activeAlerts = useMemo(() => alerts.filter((alert) => !alert.dismissed), [alerts]);

  const domainSummary = useMemo(() => {
    return DOMAIN_REGISTRY.map((domain) => {
      const domainLayers = Object.values(layers).filter((layer) => layer.domain === domain.id);
      const visibleCount = domainLayers.filter((layer) => layer.visible).length;
      return {
        ...domain,
        total: domainLayers.length,
        visible: visibleCount,
      };
    }).filter((domain) => domain.total > 0);
  }, [layers]);

  const selectedEntries = useMemo(() => {
    if (!selectedObject) return [];
    return Object.entries(selectedObject.properties).slice(0, 8);
  }, [selectedObject]);

  const feedItems = useMemo(() => {
    return activeAlerts.slice(0, 5).map((alert) => ({
      id: alert.id,
      title: alert.title,
      description: alert.message,
      severity: alert.severity,
      timestampLabel: new Date(alert.timestamp).toLocaleTimeString('ko-KR', { hour12: false }),
    }));
  }, [activeAlerts]);

  if (!rightPanelOpen) {
    return (
      <button
        onClick={() => setRightPanelOpen(true)}
        className="absolute right-4 top-1/2 z-[70] -translate-y-1/2 rounded-xl border border-cyan-900/40 bg-[#0a0f14]/85 p-3 text-cyan-500 backdrop-blur-md transition-colors hover:border-cyan-700/50 hover:text-cyan-300"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    );
  }

  return (
    <aside className="absolute right-4 top-4 z-[70] flex h-[calc(100vh-2rem)] w-[320px] flex-col gap-3 pointer-events-auto">
      <GlassCard
        title="Object Detail"
        subtitle={selectedObject ? `${selectedObject.domain.toUpperCase()} • ${selectedObject.type}` : 'No object selected'}
        rightSlot={
          <button
            onClick={() => setRightPanelOpen(false)}
            className="rounded-lg border border-cyan-900/40 p-1 text-cyan-700 transition-colors hover:border-cyan-700/60 hover:text-cyan-300"
            aria-label="Close right status panel"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        }
      >
        {selectedObject ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
              <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-700">Object ID</span>
              <span className="max-w-[150px] truncate text-[10px] text-cyan-300">{selectedObject.id}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                <p className="text-[9px] tracking-[0.2em] text-cyan-800">LAT</p>
                <p className="mt-1 text-[11px] text-cyan-300">{selectedObject.coordinates[1].toFixed(4)}</p>
              </div>
              <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
                <p className="text-[9px] tracking-[0.2em] text-cyan-800">LNG</p>
                <p className="mt-1 text-[11px] text-cyan-300">{selectedObject.coordinates[0].toFixed(4)}</p>
              </div>
            </div>
            <ul className="space-y-1.5">
              {selectedEntries.map(([key, value]) => (
                <li key={key} className="flex items-center justify-between gap-2 rounded-lg border border-cyan-900/20 bg-cyan-950/20 px-2.5 py-1.5">
                  <span className="max-w-[45%] truncate text-[10px] uppercase tracking-wider text-cyan-700">{key}</span>
                  <span className="max-w-[55%] truncate text-right text-[10px] text-cyan-300">{formatValue(value)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-cyan-900/30 bg-cyan-950/15 text-[10px] tracking-[0.2em] text-cyan-700">
            MAP OBJECT SELECT REQUIRED
          </div>
        )}
      </GlassCard>

      <GlassCard
        title="Domain Summary"
        subtitle="Layer activity by domain"
        rightSlot={<StatusBadge tone={activeAlerts.length > 0 ? 'warning' : 'active'}>{activeAlerts.length} ALERTS</StatusBadge>}
        className="flex-1 overflow-hidden"
      >
        <div className="space-y-2 overflow-y-auto pr-1 no-scrollbar">
          {domainSummary.map((domain) => (
            <div key={domain.id} className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = DOMAIN_ICONS[domain.id];
                    return <Icon className="w-3.5 h-3.5" style={{ color: domain.color }} />;
                  })()}
                  <span className="text-[10px] tracking-[0.15em] text-cyan-400">{domain.nameKo}</span>
                </div>
                <StatusBadge tone={domain.visible > 0 ? 'active' : 'default'}>
                  {domain.visible}/{domain.total}
                </StatusBadge>
              </div>
              <MiniChart
                values={[
                  Math.max(domain.total - 2, 0),
                  Math.max(domain.total - 1, 0),
                  domain.total,
                  Math.max(domain.visible - 1, 0),
                  domain.visible,
                ]}
                stroke={domain.color}
              />
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard title="Live Feed" subtitle="Alert engine stream" className="max-h-[32%] overflow-hidden">
        <DataFeed items={feedItems} emptyMessage="No active alerts" />
      </GlassCard>

      <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-center justify-between text-[9px] tracking-[0.2em] text-cyan-800">
        <span className="inline-flex items-center gap-1"><Radar className="h-3 w-3" />LINKED</span>
        <span className="inline-flex items-center gap-1"><Siren className="h-3 w-3" />ALERT BUS</span>
        <span className="inline-flex items-center gap-1"><Target className="h-3 w-3" />STORE</span>
      </div>
    </aside>
  );
}
