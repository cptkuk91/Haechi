'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  BellRing,
  ChevronDown,
  Filter,
  MapPinned,
  Search,
  X,
  BarChart3,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { DOMAIN_REGISTRY } from '@/types/domain';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import StatusBadge from '@/components/ui/StatusBadge';
import type { Alert, AlertSeverity, DomainType } from '@/types/domain';

type DashboardTab = 'active' | 'history' | 'stats';

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour12: false });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}

export default function AlertDashboard() {
  const alerts = useAppStore((s) => s.alerts);
  const flyTo = useAppStore((s) => s.flyTo);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const layers = useAppStore((s) => s.layers);
  const dismissAlert = useAppStore((s) => s.dismissAlert);
  const dismissAllAlerts = useAppStore((s) => s.dismissAllAlerts);
  const clearDismissedAlerts = useAppStore((s) => s.clearDismissedAlerts);
  const clearAllAlerts = useAppStore((s) => s.clearAllAlerts);
  const alertPreferences = useAppStore((s) => s.alertPreferences);
  const setAlertSeverityEnabled = useAppStore((s) => s.setAlertSeverityEnabled);
  const setAlertDomainEnabled = useAppStore((s) => s.setAlertDomainEnabled);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DashboardTab>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<AlertSeverity | 'all'>('all');
  const [filterDomain, setFilterDomain] = useState<DomainType | 'all'>('all');
  const [showFilters, setShowFilters] = useState(false);

  const activeAlerts = useMemo(() => alerts.filter((a) => !a.dismissed), [alerts]);
  const dismissedAlerts = useMemo(() => alerts.filter((a) => a.dismissed), [alerts]);

  const filteredAlerts = useMemo(() => {
    const source = tab === 'active' ? activeAlerts : dismissedAlerts;
    return source
      .filter((a) => {
        if (filterSeverity !== 'all' && a.severity !== filterSeverity) return false;
        if (filterDomain !== 'all' && a.domain !== filterDomain) return false;
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return (
            a.title.toLowerCase().includes(q) ||
            a.message.toLowerCase().includes(q) ||
            a.domain.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.timestamp - a.timestamp);
  }, [tab, activeAlerts, dismissedAlerts, filterSeverity, filterDomain, searchQuery]);

  // 도메인별/등급별 통계
  const stats = useMemo(() => {
    const bySeverity: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
    const byDomain: Record<string, number> = {};

    for (const a of activeAlerts) {
      bySeverity[a.severity]++;
      byDomain[a.domain] = (byDomain[a.domain] || 0) + 1;
    }

    return { bySeverity, byDomain };
  }, [activeAlerts]);

  const handleAlertClick = useCallback(
    (alert: Alert) => {
      // flyTo
      if (alert.coordinates) {
        flyTo(alert.coordinates[1], alert.coordinates[0], 12);
      }
      // 관련 도메인 레이어 자동 활성화
      const domainLayers = Object.values(layers).filter(
        (l) => l.domain === alert.domain && !l.visible
      );
      for (const layer of domainLayers) {
        toggleLayer(layer.id);
      }
    },
    [flyTo, toggleLayer, layers]
  );

  const criticalCount = activeAlerts.filter((a) => a.severity === 'critical').length;
  const totalEnabledPreferences =
    Object.values(alertPreferences.severities).filter(Boolean).length +
    Object.values(alertPreferences.domains).filter(Boolean).length;
  const totalPreferenceSlots =
    Object.keys(alertPreferences.severities).length +
    Object.keys(alertPreferences.domains).length;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-20 right-4 z-[70] flex items-center gap-2 rounded-xl border border-cyan-900/40 bg-[#0a0f14]/85 px-3 py-2.5 text-cyan-500 backdrop-blur-md transition-colors hover:border-cyan-700/50 hover:text-cyan-300 pointer-events-auto"
      >
        <Activity className="h-4 w-4" />
        <span className="text-[10px] tracking-[0.2em] uppercase">Alerts</span>
        {activeAlerts.length > 0 && (
          <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
            criticalCount > 0
              ? 'bg-red-500/80 text-white'
              : 'bg-cyan-500/80 text-black'
          }`}>
            {activeAlerts.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute top-20 right-4 z-[70] w-[380px] max-h-[70vh] flex flex-col rounded-2xl border border-cyan-900/40 bg-[#0a0f14]/90 shadow-2xl shadow-cyan-950/20 backdrop-blur-md pointer-events-auto"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between p-3 pb-2 border-b border-cyan-900/30 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-500" />
          <span className="text-[10px] tracking-[0.25em] uppercase text-cyan-400 font-mono">
            Alert Dashboard
          </span>
          {activeAlerts.length > 0 && (
            <span className="px-1.5 py-0.5 bg-cyan-900/50 rounded text-[9px] text-cyan-300 font-mono">
              {activeAlerts.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1 rounded transition-colors ${
              showFilters ? 'bg-cyan-900/40 text-cyan-300' : 'text-cyan-700 hover:text-cyan-400'
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1 hover:bg-cyan-950/50 rounded transition-colors"
          >
            <X className="h-3.5 w-3.5 text-cyan-700 hover:text-cyan-400" />
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-cyan-900/30 shrink-0">
        {(['active', 'history', 'stats'] as DashboardTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[9px] tracking-[0.2em] uppercase font-mono transition-colors ${
              tab === t
                ? 'text-cyan-300 border-b-2 border-cyan-500'
                : 'text-cyan-700 hover:text-cyan-500'
            }`}
          >
            {t === 'active' ? `Active (${activeAlerts.length})` : t === 'history' ? 'History' : 'Stats'}
          </button>
        ))}
      </div>

      <div className="border-b border-cyan-900/30 p-2 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={dismissAllAlerts}
            disabled={activeAlerts.length === 0}
            className="flex-1 rounded-lg border border-cyan-900/40 px-2 py-1 text-[9px] uppercase tracking-[0.18em] font-mono text-cyan-500 transition-colors enabled:hover:border-cyan-700/50 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-cyan-950/40 disabled:text-cyan-900"
          >
            Active Clear
          </button>
          <button
            onClick={clearDismissedAlerts}
            disabled={dismissedAlerts.length === 0}
            className="flex-1 rounded-lg border border-cyan-900/40 px-2 py-1 text-[9px] uppercase tracking-[0.18em] font-mono text-cyan-500 transition-colors enabled:hover:border-cyan-700/50 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:border-cyan-950/40 disabled:text-cyan-900"
          >
            History Clear
          </button>
          <button
            onClick={clearAllAlerts}
            disabled={alerts.length === 0}
            className="inline-flex items-center justify-center rounded-lg border border-red-900/40 px-2 py-1 text-[9px] uppercase tracking-[0.18em] font-mono text-red-500 transition-colors enabled:hover:border-red-700/50 enabled:hover:text-red-300 disabled:cursor-not-allowed disabled:border-red-950/30 disabled:text-red-950/70"
            aria-label="Clear all alerts"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 필터 */}
      <AnimatePresence>
        {showFilters && tab !== 'stats' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-cyan-900/30 shrink-0"
          >
            <div className="p-2 space-y-2">
              <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/15 p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-cyan-500 font-mono">
                    <BellRing className="h-3 w-3" />
                    Intake
                  </span>
                  <span className="text-[8px] text-cyan-700 font-mono">
                    {totalEnabledPreferences}/{totalPreferenceSlots}
                  </span>
                </div>
                <div className="flex gap-1.5 mb-1.5">
                  {(['critical', 'warning', 'info'] as const).map((severity) => {
                    const enabled = alertPreferences.severities[severity];
                    return (
                      <button
                        key={severity}
                        onClick={() => setAlertSeverityEnabled(severity, !enabled)}
                        className={`px-2 py-1 rounded-lg text-[9px] uppercase tracking-wider font-mono transition-colors ${
                          enabled
                            ? severity === 'critical'
                              ? 'bg-red-950/60 border border-red-500/40 text-red-300'
                              : severity === 'warning'
                                ? 'bg-amber-950/60 border border-amber-500/40 text-amber-300'
                                : 'bg-blue-950/60 border border-blue-500/40 text-blue-300'
                            : 'text-cyan-800 border border-cyan-950/60 hover:text-cyan-500'
                        }`}
                      >
                        {severity}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {DOMAIN_REGISTRY.map((domain) => {
                    const Icon = DOMAIN_ICONS[domain.id];
                    const enabled = alertPreferences.domains[domain.id];
                    return (
                      <button
                        key={domain.id}
                        onClick={() => setAlertDomainEnabled(domain.id, !enabled)}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-mono transition-colors ${
                          enabled
                            ? 'bg-cyan-900/35 text-cyan-300 border border-cyan-800/40'
                            : 'text-cyan-800 border border-cyan-950/50 hover:text-cyan-500'
                        }`}
                      >
                        <Icon className="h-2.5 w-2.5" style={{ color: domain.color }} />
                        {domain.nameKo.slice(0, 4)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/15 p-2">
                <div className="mb-1.5 text-[9px] uppercase tracking-[0.2em] text-cyan-500 font-mono">
                  View Filter
                </div>
                <div className="relative mb-1.5">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-cyan-800" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search alerts..."
                    className="w-full bg-cyan-950/30 border border-cyan-900/30 rounded-lg pl-7 pr-3 py-1.5 text-[10px] text-cyan-300 placeholder-cyan-800 focus:outline-none focus:border-cyan-700/50 font-mono"
                  />
                </div>
                <div className="flex gap-1.5 mb-1.5">
                  {(['all', 'critical', 'warning', 'info'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setFilterSeverity(s)}
                      className={`px-2 py-1 rounded-lg text-[9px] uppercase tracking-wider font-mono transition-colors ${
                        filterSeverity === s
                          ? s === 'critical' ? 'bg-red-950/50 border border-red-500/40 text-red-300'
                            : s === 'warning' ? 'bg-amber-950/50 border border-amber-500/40 text-amber-300'
                            : s === 'info' ? 'bg-blue-950/50 border border-blue-500/40 text-blue-300'
                            : 'bg-cyan-900/40 border border-cyan-700/40 text-cyan-300'
                          : 'text-cyan-700 border border-transparent hover:text-cyan-500'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button
                    onClick={() => setFilterDomain('all')}
                    className={`px-2 py-0.5 rounded text-[8px] uppercase tracking-wider font-mono transition-colors ${
                      filterDomain === 'all'
                        ? 'bg-cyan-900/40 text-cyan-300'
                        : 'text-cyan-700 hover:text-cyan-500'
                    }`}
                  >
                    All
                  </button>
                  {DOMAIN_REGISTRY.filter((d) => stats.byDomain[d.id]).map((d) => {
                    const Icon = DOMAIN_ICONS[d.id];
                    return (
                      <button
                        key={d.id}
                        onClick={() => setFilterDomain(d.id)}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono transition-colors ${
                          filterDomain === d.id
                            ? 'bg-cyan-900/40 text-cyan-300'
                            : 'text-cyan-700 hover:text-cyan-500'
                        }`}
                      >
                        <Icon className="w-2.5 h-2.5" style={{ color: d.color }} />
                        {stats.byDomain[d.id]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 컨텐츠 */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {tab === 'stats' ? (
          <StatsView stats={stats} total={alerts.length} active={activeAlerts.length} />
        ) : (
          <AlertListView
            alerts={filteredAlerts}
            onAlertClick={handleAlertClick}
            onDismiss={tab === 'active' ? dismissAlert : undefined}
            emptyMessage={tab === 'active' ? 'No active alerts' : 'No dismissed alerts'}
          />
        )}
      </div>
    </motion.div>
  );
}

function AlertListView({
  alerts,
  onAlertClick,
  onDismiss,
  emptyMessage,
}: {
  alerts: Alert[];
  onAlertClick: (alert: Alert) => void;
  onDismiss?: (id: string) => void;
  emptyMessage: string;
}) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-[10px] tracking-[0.2em] text-cyan-800 font-mono">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      {alerts.map((alert) => {
        const domainInfo = DOMAIN_REGISTRY.find((d) => d.id === alert.domain);
        const Icon = DOMAIN_ICONS[alert.domain];
        return (
          <div
            key={alert.id}
            className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 p-2.5 hover:bg-cyan-950/30 transition-colors cursor-pointer group"
            onClick={() => onAlertClick(alert)}
          >
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: domainInfo?.color }} />
                <span className="text-[10px] text-cyan-300 font-mono truncate">{alert.title}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <StatusBadge tone={alert.severity}>{alert.severity}</StatusBadge>
                {onDismiss && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(alert.id);
                    }}
                    className="p-0.5 rounded text-cyan-800 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-cyan-600 leading-relaxed mb-1.5 line-clamp-2">{alert.message}</p>
            <div className="flex items-center justify-between">
              <span className="text-[8px] text-cyan-800 font-mono tracking-wider">
                {formatDate(alert.timestamp)} {formatTime(alert.timestamp)}
              </span>
              {alert.coordinates && (
                <span className="flex items-center gap-0.5 text-[8px] text-cyan-700 font-mono">
                  <MapPinned className="w-2.5 h-2.5" />
                  {alert.coordinates[1].toFixed(2)}, {alert.coordinates[0].toFixed(2)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatsView({
  stats,
  total,
  active,
}: {
  stats: { bySeverity: Record<AlertSeverity, number>; byDomain: Record<string, number> };
  total: number;
  active: number;
}) {
  const maxDomainCount = Math.max(...Object.values(stats.byDomain), 1);

  return (
    <div className="p-3 space-y-4">
      {/* 요약 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 p-2 text-center">
          <p className="text-[8px] text-cyan-800 uppercase tracking-wider">Total</p>
          <p className="text-lg text-cyan-300 font-mono">{total}</p>
        </div>
        <div className="rounded-xl border border-cyan-900/30 bg-cyan-950/20 p-2 text-center">
          <p className="text-[8px] text-cyan-800 uppercase tracking-wider">Active</p>
          <p className="text-lg text-cyan-300 font-mono">{active}</p>
        </div>
        <div className="rounded-xl border border-red-900/30 bg-red-950/20 p-2 text-center">
          <p className="text-[8px] text-red-800 uppercase tracking-wider">Critical</p>
          <p className="text-lg text-red-300 font-mono">{stats.bySeverity.critical}</p>
        </div>
      </div>

      {/* 등급별 */}
      <div>
        <h4 className="text-[9px] text-cyan-600 uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3" /> By Severity
        </h4>
        <div className="space-y-1.5">
          {(['critical', 'warning', 'info'] as AlertSeverity[]).map((sev) => {
            const count = stats.bySeverity[sev];
            const pct = active > 0 ? (count / active) * 100 : 0;
            const barColor = sev === 'critical' ? 'bg-red-500' : sev === 'warning' ? 'bg-amber-500' : 'bg-blue-500';
            return (
              <div key={sev} className="flex items-center gap-2">
                <span className="text-[9px] text-cyan-600 font-mono w-14 uppercase">{sev}</span>
                <div className="flex-1 h-2 bg-cyan-950/40 rounded-full overflow-hidden">
                  <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[9px] text-cyan-400 font-mono w-5 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 도메인별 */}
      <div>
        <h4 className="text-[9px] text-cyan-600 uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5">
          <ChevronDown className="w-3 h-3" /> By Domain
        </h4>
        <div className="space-y-1.5">
          {Object.entries(stats.byDomain)
            .sort((a, b) => b[1] - a[1])
            .map(([domain, count]) => {
              const domainInfo = DOMAIN_REGISTRY.find((d) => d.id === domain);
              const Icon = DOMAIN_ICONS[domain as DomainType];
              const pct = (count / maxDomainCount) * 100;
              return (
                <div key={domain} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 w-20">
                    {Icon && <Icon className="w-3 h-3" style={{ color: domainInfo?.color }} />}
                    <span className="text-[9px] text-cyan-600 font-mono truncate">
                      {domainInfo?.nameKo?.slice(0, 4) || domain}
                    </span>
                  </div>
                  <div className="flex-1 h-2 bg-cyan-950/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: domainInfo?.color || '#00f0ff' }}
                    />
                  </div>
                  <span className="text-[9px] text-cyan-400 font-mono w-5 text-right">{count}</span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
