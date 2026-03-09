'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ChevronDown, ChevronRight, Layers, Search, X } from 'lucide-react';
import { useIsFetching } from '@tanstack/react-query';
import { useAppStore } from '@/stores/app-store';
import { DOMAIN_REGISTRY } from '@/types/domain';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { getHealthAedFeatureLimitForZoom } from '@/lib/health-aed';
import { getHealthPharmacyFeatureLimitForZoom } from '@/lib/health-pharmacy';
import type { Alert, LayerConfig } from '@/types/domain';

const CCTV_MAX_DISPLAY_OPTIONS = [100, 500, 1000, 2000, 5000, 10000, 20000] as const;
const CCTV_MIN_DISPLAY = 100;
const CCTV_MAX_DISPLAY = 20_000;
const HIDDEN_LAYER_IDS = new Set([
  'vulnerable-amber-radius',
  'vulnerable-emergency-iot',
  'vulnerable-support-link',
]);
const RESTRICTED_LAYER_IDS = new Set([
  'cyber-attacks',
]);
const PERSISTENT_EMPTY_DOMAIN_IDS = new Set([
  'health',
]);
const RESTRICTED_LAYER_ALERT_ID = 'alert-restricted-cyber-access';
const RESTRICTED_LAYER_ALERT_MESSAGE = '인가 된 사용자만 확인 가능합니다.';

function getTrendMaxRangeYears(periodType: 'year' | 'month' | 'week'): number {
  if (periodType === 'week') return 2;
  if (periodType === 'month') return 3;
  return 6;
}

function normalizeTrendRange(periodType: 'year' | 'month' | 'week', startYear: number, endYear: number) {
  let nextStartYear = startYear;
  let nextEndYear = endYear;

  if (nextStartYear > nextEndYear) {
    [nextStartYear, nextEndYear] = [nextEndYear, nextStartYear];
  }

  const maxRangeYears = getTrendMaxRangeYears(periodType);
  if (nextEndYear - nextStartYear + 1 > maxRangeYears) {
    nextStartYear = nextEndYear - maxRangeYears + 1;
  }

  return {
    startYear: nextStartYear,
    endYear: nextEndYear,
  };
}

function createRestrictedAlert(): Alert {
  return {
    id: RESTRICTED_LAYER_ALERT_ID,
    severity: 'info',
    domain: 'cyber',
    title: '사이버 안보 접근 제한',
    message: RESTRICTED_LAYER_ALERT_MESSAGE,
    timestamp: Date.now(),
    dismissed: false,
  };
}

export default function LayerPanel() {
  const {
    layers,
    camera,
    toggleLayer,
    domainDataSource,
    layerDataSource,
    cctvMaxDisplayCount,
    setCctvMaxDisplayCount,
    healthInfectiousRiskFilters,
    healthInfectiousRiskMeta,
    setHealthInfectiousRiskFilters,
    healthInfectiousDistributionFilters,
    healthInfectiousDistributionMeta,
    healthInfectiousDistributionData,
    setHealthInfectiousDistributionFilters,
    healthInfectiousTrendFilters,
    healthInfectiousTrendMeta,
    setHealthInfectiousTrendFilters,
  } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [cctvCustomInput, setCctvCustomInput] = useState(String(cctvMaxDisplayCount));
  const [isHealthRiskPending, startHealthRiskTransition] = useTransition();
  const [isHealthDistributionPending, startHealthDistributionTransition] = useTransition();
  const [isHealthTrendPending, startHealthTrendTransition] = useTransition();
  const healthRiskFetchCount = useIsFetching({ queryKey: ['health', 'infectious-risk-sido'] });
  const healthAedFetchCount = useIsFetching({ queryKey: ['health', 'aed'] });
  const healthPharmacyFetchCount = useIsFetching({ queryKey: ['health', 'pharmacy'] });
  const healthDistributionFetchCount = useIsFetching({ queryKey: ['health', 'infectious-distribution'] });
  const healthTrendFetchCount = useIsFetching({ queryKey: ['health', 'infectious-trends'] });

  const showRestrictedLayerToast = () => {
    const restrictedAlert = createRestrictedAlert();

    useAppStore.setState((s) => ({
      alerts: [
        restrictedAlert,
        ...s.alerts.filter((alert) => alert.id !== RESTRICTED_LAYER_ALERT_ID),
      ].slice(0, 50),
      toastAlertIds: [
        RESTRICTED_LAYER_ALERT_ID,
        ...s.toastAlertIds.filter((alertId) => alertId !== RESTRICTED_LAYER_ALERT_ID),
      ].slice(0, 4),
    }));
  };

  useEffect(() => {
    setCctvCustomInput(String(cctvMaxDisplayCount));
  }, [cctvMaxDisplayCount]);

  useEffect(() => {
    for (const layerId of HIDDEN_LAYER_IDS) {
      const layer = layers[layerId];
      if (layer?.visible) {
        toggleLayer(layerId);
      }
    }
  }, [layers, toggleLayer]);

  const commitCctvCustomInput = () => {
    const parsed = Number(cctvCustomInput);
    if (!Number.isFinite(parsed)) {
      setCctvCustomInput(String(cctvMaxDisplayCount));
      return;
    }
    const normalized = Math.min(CCTV_MAX_DISPLAY, Math.max(CCTV_MIN_DISPLAY, Math.floor(parsed)));
    setCctvMaxDisplayCount(normalized);
    setCctvCustomInput(String(normalized));
  };

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const handleLayerToggle = (layerId: string) => {
    const layer = layers[layerId];
    if (!layer) return;
    if (RESTRICTED_LAYER_IDS.has(layerId) && !layer.visible) {
      showRestrictedLayerToast();
      return;
    }
    toggleLayer(layerId);
  };

  // 도메인별 레이어 그룹핑
  const layersByDomain = DOMAIN_REGISTRY.map((domain) => {
    const domainLayers = Object.values(layers).filter((l) => l.domain === domain.id && !HIDDEN_LAYER_IDS.has(l.id));
    return { ...domain, layers: domainLayers };
  }).filter((d) => d.layers.length > 0 || PERSISTENT_EMPTY_DOMAIN_IDS.has(d.id));

  const activeLayerCount = Object.values(layers).filter((l) => l.visible && !HIDDEN_LAYER_IDS.has(l.id)).length;
  const healthInfectiousRiskSelectedDiseaseLabel = useMemo(() => {
    if (!healthInfectiousRiskFilters.disease) return '전체 감염병';
    return healthInfectiousRiskMeta.diseaseOptions.find((option) => option.value === healthInfectiousRiskFilters.disease)?.label
      ?? healthInfectiousRiskFilters.disease;
  }, [healthInfectiousRiskFilters.disease, healthInfectiousRiskMeta.diseaseOptions]);
  const healthInfectiousRiskLatestYearLabel = useMemo(() => {
    return healthInfectiousRiskMeta.selectedYear ? `최신 (${healthInfectiousRiskMeta.selectedYear}년)` : '최신';
  }, [healthInfectiousRiskMeta.selectedYear]);
  const healthInfectiousRiskMetricLabel = useMemo(() => {
    return healthInfectiousRiskFilters.metric === 'count' ? '발생건수' : '10만명당 발생률';
  }, [healthInfectiousRiskFilters.metric]);
  const healthInfectiousRiskUpdatedAtLabel = useMemo(() => {
    if (!healthInfectiousRiskMeta.updatedAt) return null;
    const parsed = new Date(healthInfectiousRiskMeta.updatedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString('ko-KR', { hour12: false });
  }, [healthInfectiousRiskMeta.updatedAt]);
  const isHealthRiskLoading = isHealthRiskPending || healthRiskFetchCount > 0;
  const isHealthAedLoading = healthAedFetchCount > 0;
  const isHealthPharmacyLoading = healthPharmacyFetchCount > 0;
  const updateHealthInfectiousRiskFilters = (next: Partial<typeof healthInfectiousRiskFilters>) => {
    startHealthRiskTransition(() => {
      setHealthInfectiousRiskFilters(next);
    });
  };
  const healthInfectiousDistributionSelectedDiseaseLabel = useMemo(() => {
    if (healthInfectiousDistributionFilters.disease) return healthInfectiousDistributionFilters.disease;
    return healthInfectiousDistributionData?.selectedDiseaseLabel
      ? `자동: ${healthInfectiousDistributionData.selectedDiseaseLabel}`
      : '자동 선택';
  }, [healthInfectiousDistributionData?.selectedDiseaseLabel, healthInfectiousDistributionFilters.disease]);
  const healthInfectiousDistributionLatestYearLabel = useMemo(() => {
    return healthInfectiousDistributionMeta.selectedYear ? `최신 (${healthInfectiousDistributionMeta.selectedYear}년)` : '최신';
  }, [healthInfectiousDistributionMeta.selectedYear]);
  const healthInfectiousDistributionMetricLabel = useMemo(() => {
    return healthInfectiousDistributionFilters.metric === 'count' ? '발생건수' : '10만명당 발생률';
  }, [healthInfectiousDistributionFilters.metric]);
  const healthInfectiousDistributionUpdatedAtLabel = useMemo(() => {
    if (!healthInfectiousDistributionMeta.updatedAt) return null;
    const parsed = new Date(healthInfectiousDistributionMeta.updatedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString('ko-KR', { hour12: false });
  }, [healthInfectiousDistributionMeta.updatedAt]);
  const isHealthDistributionLoading = isHealthDistributionPending || healthDistributionFetchCount > 0;
  const updateHealthInfectiousDistributionFilters = (next: Partial<typeof healthInfectiousDistributionFilters>) => {
    startHealthDistributionTransition(() => {
      setHealthInfectiousDistributionFilters(next);
    });
  };
  const healthInfectiousTrendSelectedDiseaseLabel = useMemo(() => {
    if (!healthInfectiousTrendFilters.disease) return '전체 감염병';
    return healthInfectiousTrendMeta.diseaseOptions.find((option) => option.value === healthInfectiousTrendFilters.disease)?.label
      ?? healthInfectiousTrendFilters.disease;
  }, [healthInfectiousTrendFilters.disease, healthInfectiousTrendMeta.diseaseOptions]);
  const healthInfectiousTrendPeriodLabel = useMemo(() => {
    if (healthInfectiousTrendFilters.periodType === 'month') return '월별';
    return '연도별';
  }, [healthInfectiousTrendFilters.periodType]);
  const healthInfectiousTrendUpdatedAtLabel = useMemo(() => {
    if (!healthInfectiousTrendMeta.updatedAt) return null;
    const parsed = new Date(healthInfectiousTrendMeta.updatedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString('ko-KR', { hour12: false });
  }, [healthInfectiousTrendMeta.updatedAt]);
  const isHealthTrendLoading = isHealthTrendPending || healthTrendFetchCount > 0;
  const healthAedFeatureLimit = useMemo(() => {
    return getHealthAedFeatureLimitForZoom(camera.zoom);
  }, [camera.zoom]);
  const healthPharmacyFeatureLimit = useMemo(() => {
    return getHealthPharmacyFeatureLimitForZoom(camera.zoom);
  }, [camera.zoom]);
  const updateHealthInfectiousTrendFilters = (next: Partial<typeof healthInfectiousTrendFilters>) => {
    startHealthTrendTransition(() => {
      setHealthInfectiousTrendFilters(next);
    });
  };

  useEffect(() => {
    if (healthInfectiousTrendFilters.periodType !== 'week') return;
    const normalizedRange = normalizeTrendRange('month', healthInfectiousTrendFilters.startYear, healthInfectiousTrendFilters.endYear);
    setHealthInfectiousTrendFilters({
      periodType: 'month',
      startYear: normalizedRange.startYear,
      endYear: normalizedRange.endYear,
    });
  }, [
    healthInfectiousTrendFilters.endYear,
    healthInfectiousTrendFilters.periodType,
    healthInfectiousTrendFilters.startYear,
    setHealthInfectiousTrendFilters,
  ]);

  // 검색 필터
  const filteredDomains = searchQuery
    ? layersByDomain.filter(
        (d) =>
          d.nameKo.includes(searchQuery) ||
          d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.layers.some((l) => l.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : layersByDomain;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute left-4 top-1/2 -translate-y-1/2 z-40 p-3 bg-[#0f2847] border border-cyan-400/50 rounded-xl hover:border-cyan-300/70 transition-colors group"
      >
        <Layers className="w-5 h-5 text-cyan-300 group-hover:text-cyan-100 transition-colors" />
        {activeLayerCount > 0 && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-300 rounded-full flex items-center justify-center">
            <span className="text-[8px] text-black font-bold">{activeLayerCount}</span>
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-40 w-72 pointer-events-auto">
      <div className="bg-[#0f2847] border border-cyan-400/50 rounded-2xl shadow-2xl shadow-black/40 max-h-[70vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 pb-3 border-b border-cyan-400/35 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-100" />
            <span className="text-[11px] tracking-[0.3em] uppercase text-cyan-50 font-semibold font-mono">
              Data Layers
            </span>
            {activeLayerCount > 0 && (
              <span className="px-1.5 py-0.5 bg-cyan-600/35 rounded text-[10px] text-white font-mono">
                {activeLayerCount}
              </span>
            )}
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 hover:bg-cyan-600/20 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5 text-cyan-300 hover:text-white" />
          </button>
        </div>

        {/* 검색 */}
        <div className="px-4 py-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-300" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search layers..."
              className="w-full bg-cyan-800/20 border border-cyan-400/35 rounded-lg pl-8 pr-3 py-2 text-[11px] text-white placeholder-cyan-300/70 focus:outline-none focus:border-cyan-300/60 font-mono"
            />
          </div>
        </div>

        {/* 레이어 목록 */}
        <div className="overflow-y-auto px-3 pb-3 flex-1 no-scrollbar">
          {filteredDomains.length === 0 ? (
            <div className="text-center py-8 text-cyan-200 text-[11px] font-mono">
              {searchQuery ? 'No layers found' : 'No layers registered'}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredDomains.map((domain) => {
                const isExpanded = expandedDomains.has(domain.id);
                const activeDomainLayers = domain.layers.filter((l) => l.visible).length;
                const isUpstream = domainDataSource[domain.id] === 'upstream'
                  || domain.layers.some((layer) => layerDataSource[layer.id] === 'upstream');

                return (
                  <div key={domain.id}>
                    {/* 도메인 헤더 */}
                    <button
                      onClick={() => toggleDomain(domain.id)}
                      className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-cyan-600/15 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        {(() => {
                          const Icon = DOMAIN_ICONS[domain.id];
                          return <Icon className="w-4 h-4" style={{ color: domain.color }} />;
                        })()}
                        <span className="text-[12px] text-white/90 tracking-wider font-medium font-mono">
                          {domain.nameKo}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isUpstream && (
                          <span
                            title="Live upstream data connected"
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-900/25 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.18em] text-emerald-200"
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            OK
                          </span>
                        )}
                        {activeDomainLayers > 0 && (
                          <span className="px-1.5 py-0.5 bg-cyan-600/30 rounded text-[9px] text-white font-mono">
                            {activeDomainLayers}/{domain.layers.length}
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-cyan-200" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-cyan-200" />
                        )}
                      </div>
                    </button>

                    {/* 레이어 아이템 */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="pl-6 space-y-0.5 pb-1">
                            {domain.layers.length === 0 ? (
                              <div className="rounded-md border border-cyan-500/20 bg-cyan-900/10 px-2.5 py-2 text-[10px] tracking-wider text-cyan-200/75 font-mono">
                                등록된 레이어 없음
                              </div>
                            ) : (
                              domain.layers.map((layer) => (
                                <LayerItem
                                  key={layer.id}
                                  layer={layer}
                                  label={
                                    layer.id === 'cyber-attacks'
                                      ? '사이버 공격 빔 (보류)'
                                      : layer.id === 'infra-public-facility-safety' && layerDataSource[layer.id] === 'upstream'
                                        ? '공공시설물 안전 (완료)'
                                      : layer.id === 'infra-highway-tollgates' && layerDataSource[layer.id] === 'upstream'
                                        ? '도로공사 영업소 (완료)'
                                      : layer.id === 'highway-incidents' && layerDataSource[layer.id] === 'upstream'
                                        ? '서울 실시간 돌발정보 (완료)'
                                      : layer.id === 'disaster-wildfire-points' && layerDataSource[layer.id] === 'upstream'
                                        ? '산불 발생 지점 (완료)'
                                      : layer.id === 'no-fly-zones' && layerDataSource[layer.id] === 'upstream'
                                        ? '비행금지구역 (완료)'
                                      : layer.id === 'traffic-cctv-markers' && layerDataSource[layer.id] === 'upstream'
                                        ? '교통관제 CCTV (완료)'
                                      : layer.id === 'health-emergency-room-location' && layerDataSource[layer.id] === 'upstream'
                                        ? '응급실 위치 (완료)'
                                      : layer.id === 'health-trauma-centers' && layerDataSource[layer.id] === 'upstream'
                                        ? '외상센터 (완료)'
                                      : layer.id === 'health-aed-locations' && layerDataSource[layer.id] === 'upstream'
                                        ? '자동심장충격기(AED) (완료)'
                                      : layer.id === 'health-pharmacy-locations' && layerDataSource[layer.id] === 'upstream'
                                        ? '약국 위치 (완료)'
                                      : layer.id === 'health-infectious-risk-sido' && layerDataSource[layer.id] === 'upstream'
                                        ? '시도별 감염 위험도 (완료)'
                                      : layer.id === 'health-infectious-trends' && layerDataSource[layer.id] === 'upstream'
                                        ? '기간별 감염 추세 (완료)'
                                      : layer.id === 'health-infectious-distribution' && layerDataSource[layer.id] === 'upstream'
                                        ? '감염병 상세 분포 (완료)'
                                      : layer.id === 'vulnerable-missing-persons' && layerDataSource[layer.id] === 'upstream'
                                        ? '실종 발생 위치 (완료)'
                                      : layer.id === 'vulnerable-elderly-welfare-facilities' && layerDataSource[layer.id] === 'upstream'
                                        ? '노인복지시설 (완료)'
                                      : layer.id === 'vulnerable-child-welfare-facilities' && layerDataSource[layer.id] === 'upstream'
                                        ? '아동복지시설 (완료)'
                                      : layer.id === 'vulnerable-disabled-facilities' && layerDataSource[layer.id] === 'upstream'
                                        ? '장애인 편의시설 (완료)'
                                      : layer.id === 'vulnerable-multicultural-support-centers' && layerDataSource[layer.id] === 'upstream'
                                        ? '다문화가족지원센터 (완료)'
                                      : undefined
                                  }
                                  onToggle={() => handleLayerToggle(layer.id)}
                                >
                                  {layer.id === 'traffic-cctv-markers' && layer.visible && (
                                    <div className="px-2 pb-2">
                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Max Markers
                                        </span>
                                        <select
                                          value={cctvMaxDisplayCount}
                                          onChange={(event) => {
                                            const nextValue = Number(event.target.value);
                                            setCctvMaxDisplayCount(nextValue);
                                            setCctvCustomInput(String(nextValue));
                                          }}
                                          className="min-w-[84px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          {CCTV_MAX_DISPLAY_OPTIONS.map((count) => (
                                            <option key={count} value={count}>
                                              {count.toLocaleString()}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                      <label className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Custom
                                        </span>
                                        <input
                                          type="number"
                                          min={CCTV_MIN_DISPLAY}
                                          max={CCTV_MAX_DISPLAY}
                                          step={100}
                                          value={cctvCustomInput}
                                          onChange={(event) => setCctvCustomInput(event.target.value)}
                                          onBlur={commitCctvCustomInput}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              event.preventDefault();
                                              commitCctvCustomInput();
                                            }
                                          }}
                                          className="w-[92px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        />
                                      </label>
                                      <p className="px-1 pt-1 text-[9px] tracking-wider text-cyan-200/80 font-mono">
                                        Range: {CCTV_MIN_DISPLAY.toLocaleString()} - {CCTV_MAX_DISPLAY.toLocaleString()}
                                      </p>
                                    </div>
                                  )}
                                  {layer.id === 'health-infectious-risk-sido' && layer.visible && (
                                    <div className="px-2 pb-2 space-y-1.5">
                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Year
                                        </span>
                                        <select
                                          value={healthInfectiousRiskFilters.year ?? 'latest'}
                                          onChange={(event) => {
                                            const raw = event.target.value;
                                            updateHealthInfectiousRiskFilters({
                                              year: raw === 'latest' ? null : Number(raw),
                                            });
                                          }}
                                          className="min-w-[110px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          <option value="latest">{healthInfectiousRiskLatestYearLabel}</option>
                                          {healthInfectiousRiskMeta.availableYears.map((year) => (
                                            <option key={year} value={year}>
                                              {year}년
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Disease
                                        </span>
                                        <select
                                          value={healthInfectiousRiskFilters.disease ?? 'all'}
                                          onChange={(event) => {
                                            const raw = event.target.value;
                                            updateHealthInfectiousRiskFilters({
                                              disease: raw === 'all' ? null : raw,
                                            });
                                          }}
                                          className="min-w-[110px] max-w-[132px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          <option value="all">전체 감염병</option>
                                          {healthInfectiousRiskMeta.diseaseOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.group ? `${option.label} (${option.group})` : option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <div className="rounded-md border border-cyan-500/25 bg-cyan-900/10 p-1">
                                        <div className="grid grid-cols-2 gap-1">
                                          <button
                                            type="button"
                                            onClick={() => updateHealthInfectiousRiskFilters({ metric: 'incidence' })}
                                            className={`rounded px-2 py-1 text-[10px] font-mono transition-colors ${
                                              healthInfectiousRiskFilters.metric === 'incidence'
                                                ? 'bg-cyan-300 text-[#04121e]'
                                                : 'bg-[#0b1f31] text-cyan-100 hover:bg-cyan-900/40'
                                            }`}
                                          >
                                            10만명당
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => updateHealthInfectiousRiskFilters({ metric: 'count' })}
                                            className={`rounded px-2 py-1 text-[10px] font-mono transition-colors ${
                                              healthInfectiousRiskFilters.metric === 'count'
                                                ? 'bg-cyan-300 text-[#04121e]'
                                                : 'bg-[#0b1f31] text-cyan-100 hover:bg-cyan-900/40'
                                            }`}
                                          >
                                            발생건수
                                          </button>
                                        </div>
                                      </div>

                                      <p className="px-1 text-[9px] tracking-wider text-cyan-200/80 font-mono">
                                        {`${healthInfectiousRiskFilters.year === null ? healthInfectiousRiskLatestYearLabel : `${healthInfectiousRiskFilters.year}년`} · ${healthInfectiousRiskSelectedDiseaseLabel} · ${healthInfectiousRiskMetricLabel}${isHealthRiskLoading ? ' · 로드 중...' : healthInfectiousRiskUpdatedAtLabel ? ` · ${healthInfectiousRiskUpdatedAtLabel} 기준` : ''}`}
                                      </p>
                                    </div>
                                  )}
                                  {layer.id === 'health-aed-locations' && layer.visible && (
                                    <div className="px-2 pb-2">
                                      <div className="rounded-md border border-orange-400/20 bg-orange-500/8 px-2.5 py-2 text-[10px] tracking-wider text-orange-100/85 font-mono">
                                        {`현재 줌 기준 상위 ${healthAedFeatureLimit.toLocaleString('ko-KR')}개 좌표만 지도에 표시${isHealthAedLoading ? ' · 로드 중...' : ''}`}
                                      </div>
                                    </div>
                                  )}
                                  {layer.id === 'health-pharmacy-locations' && layer.visible && (
                                    <div className="px-2 pb-2">
                                      <div className="rounded-md border border-sky-400/20 bg-sky-500/8 px-2.5 py-2 text-[10px] tracking-wider text-sky-100/85 font-mono">
                                        {`현재 줌 기준 상위 ${healthPharmacyFeatureLimit.toLocaleString('ko-KR')}개 약국만 지도에 표시${isHealthPharmacyLoading ? ' · 로드 중...' : ''}`}
                                      </div>
                                    </div>
                                  )}
                                  {layer.id === 'health-infectious-trends' && layer.visible && (
                                    <div className="px-2 pb-2 space-y-1.5">
                                      <div className="rounded-md border border-cyan-500/25 bg-cyan-900/10 p-1">
                                        <div className="grid grid-cols-2 gap-1">
                                          {([
                                            ['year', '연도별'],
                                            ['month', '월별'],
                                          ] as const).map(([periodType, labelText]) => (
                                            <button
                                              key={periodType}
                                              type="button"
                                              onClick={() => {
                                                const normalizedRange = normalizeTrendRange(
                                                  periodType,
                                                  healthInfectiousTrendFilters.startYear,
                                                  healthInfectiousTrendFilters.endYear
                                                );
                                                updateHealthInfectiousTrendFilters({
                                                  periodType,
                                                  startYear: normalizedRange.startYear,
                                                  endYear: normalizedRange.endYear,
                                                });
                                              }}
                                              className={`rounded px-2 py-1 text-[10px] font-mono transition-colors ${
                                                healthInfectiousTrendFilters.periodType === periodType
                                                  ? 'bg-cyan-300 text-[#04121e]'
                                                  : 'bg-[#0b1f31] text-cyan-100 hover:bg-cyan-900/40'
                                              }`}
                                            >
                                              {labelText}
                                            </button>
                                          ))}
                                        </div>
                                      </div>

                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Start
                                        </span>
                                        <select
                                          value={healthInfectiousTrendFilters.startYear}
                                          onChange={(event) => {
                                            const nextStartYear = Number(event.target.value);
                                            const normalizedRange = normalizeTrendRange(
                                              healthInfectiousTrendFilters.periodType,
                                              nextStartYear,
                                              Math.max(healthInfectiousTrendFilters.endYear, nextStartYear)
                                            );
                                            updateHealthInfectiousTrendFilters(normalizedRange);
                                          }}
                                          className="min-w-[110px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          {healthInfectiousTrendMeta.availableYears.map((year) => (
                                            <option key={year} value={year}>
                                              {year}년
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          End
                                        </span>
                                        <select
                                          value={healthInfectiousTrendFilters.endYear}
                                          onChange={(event) => {
                                            const nextEndYear = Number(event.target.value);
                                            const normalizedRange = normalizeTrendRange(
                                              healthInfectiousTrendFilters.periodType,
                                              Math.min(healthInfectiousTrendFilters.startYear, nextEndYear),
                                              nextEndYear
                                            );
                                            updateHealthInfectiousTrendFilters(normalizedRange);
                                          }}
                                          className="min-w-[110px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          {healthInfectiousTrendMeta.availableYears.map((year) => (
                                            <option key={year} value={year}>
                                              {year}년
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Disease
                                        </span>
                                        <select
                                          value={healthInfectiousTrendFilters.disease ?? 'all'}
                                          onChange={(event) => {
                                            const raw = event.target.value;
                                            updateHealthInfectiousTrendFilters({
                                              disease: raw === 'all' ? null : raw,
                                            });
                                          }}
                                          className="min-w-[110px] max-w-[132px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          <option value="all">전체 감염병</option>
                                          {healthInfectiousTrendMeta.diseaseOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.group ? `${option.label} (${option.group})` : option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <p className="px-1 text-[9px] tracking-wider text-cyan-200/80 font-mono">
                                        {`${healthInfectiousTrendPeriodLabel} · ${healthInfectiousTrendFilters.startYear}년-${healthInfectiousTrendFilters.endYear}년 · ${healthInfectiousTrendSelectedDiseaseLabel}${isHealthTrendLoading ? ' · 로드 중...' : healthInfectiousTrendUpdatedAtLabel ? ` · ${healthInfectiousTrendUpdatedAtLabel} 기준` : ''}`}
                                      </p>
                                    </div>
                                  )}
                                  {layer.id === 'health-infectious-distribution' && layer.visible && (
                                    <div className="px-2 pb-2 space-y-1.5">
                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Year
                                        </span>
                                        <select
                                          value={healthInfectiousDistributionFilters.year ?? 'latest'}
                                          onChange={(event) => {
                                            const raw = event.target.value;
                                            updateHealthInfectiousDistributionFilters({
                                              year: raw === 'latest' ? null : Number(raw),
                                            });
                                          }}
                                          className="min-w-[110px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          <option value="latest">{healthInfectiousDistributionLatestYearLabel}</option>
                                          {healthInfectiousDistributionMeta.availableYears.map((year) => (
                                            <option key={year} value={year}>
                                              {year}년
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <label className="flex items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-900/10 px-2 py-1.5">
                                        <span className="text-[10px] tracking-wider text-cyan-50 font-mono">
                                          Disease
                                        </span>
                                        <select
                                          value={healthInfectiousDistributionFilters.disease ?? 'auto'}
                                          onChange={(event) => {
                                            const raw = event.target.value;
                                            updateHealthInfectiousDistributionFilters({
                                              disease: raw === 'auto' ? null : raw,
                                            });
                                          }}
                                          className="min-w-[110px] max-w-[132px] rounded border border-cyan-400/40 bg-[#0b1f31] px-1.5 py-1 text-[10px] text-cyan-50 font-mono focus:outline-none focus:border-cyan-200"
                                        >
                                          <option value="auto">자동 선택</option>
                                          {healthInfectiousDistributionMeta.diseaseOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                              {option.group ? `${option.label} (${option.group})` : option.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>

                                      <div className="rounded-md border border-cyan-500/25 bg-cyan-900/10 p-1">
                                        <div className="grid grid-cols-2 gap-1">
                                          <button
                                            type="button"
                                            onClick={() => updateHealthInfectiousDistributionFilters({ metric: 'count' })}
                                            className={`rounded px-2 py-1 text-[10px] font-mono transition-colors ${
                                              healthInfectiousDistributionFilters.metric === 'count'
                                                ? 'bg-cyan-300 text-[#04121e]'
                                                : 'bg-[#0b1f31] text-cyan-100 hover:bg-cyan-900/40'
                                            }`}
                                          >
                                            발생건수
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => updateHealthInfectiousDistributionFilters({ metric: 'incidence' })}
                                            className={`rounded px-2 py-1 text-[10px] font-mono transition-colors ${
                                              healthInfectiousDistributionFilters.metric === 'incidence'
                                                ? 'bg-cyan-300 text-[#04121e]'
                                                : 'bg-[#0b1f31] text-cyan-100 hover:bg-cyan-900/40'
                                            }`}
                                          >
                                            10만명당
                                          </button>
                                        </div>
                                      </div>

                                      <p className="px-1 text-[9px] tracking-wider text-cyan-200/80 font-mono">
                                        {`${healthInfectiousDistributionFilters.year === null ? healthInfectiousDistributionLatestYearLabel : `${healthInfectiousDistributionFilters.year}년`} · ${healthInfectiousDistributionSelectedDiseaseLabel} · ${healthInfectiousDistributionMetricLabel}${isHealthDistributionLoading ? ' · 로드 중...' : healthInfectiousDistributionUpdatedAtLabel ? ` · ${healthInfectiousDistributionUpdatedAtLabel} 기준` : ''}`}
                                      </p>
                                    </div>
                                  )}
                                </LayerItem>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LayerItem({
  layer,
  label,
  onToggle,
  children,
}: {
  layer: LayerConfig;
  label?: string;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`w-full rounded-lg transition-all duration-200 ${
        layer.visible
          ? 'bg-cyan-700/20 border border-cyan-400/50'
          : 'hover:bg-cyan-700/10 border border-transparent'
      }`}
    >
      <button onClick={onToggle} className="w-full flex items-center justify-between p-2">
        <span
          className={`text-[11px] tracking-wider font-mono ${
            layer.visible ? 'text-white' : 'text-cyan-100/80'
          }`}
        >
          {label ?? layer.name}
        </span>
        <div
          className={`w-7 h-3.5 rounded-full p-0.5 transition-colors ${
            layer.visible ? 'bg-cyan-400' : 'bg-slate-700'
          }`}
        >
          <div
            className={`w-2.5 h-2.5 rounded-full transition-transform ${
              layer.visible
                ? 'translate-x-3 bg-cyan-50 shadow-[0_0_8px_rgba(217,249,255,0.9)]'
                : 'translate-x-0 bg-slate-400'
            }`}
          />
        </div>
      </button>
      {children}
    </div>
  );
}
