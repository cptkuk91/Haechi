'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronRight, Layers, Search, X } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { DOMAIN_REGISTRY } from '@/types/domain';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import type { DomainType, LayerConfig } from '@/types/domain';

export default function LayerPanel() {
  const { layers, toggleLayer } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedDomains, setExpandedDomains] = useState<Set<DomainType>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const toggleDomain = (domain: DomainType) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  // 도메인별 레이어 그룹핑
  const layersByDomain = DOMAIN_REGISTRY.map((domain) => {
    const domainLayers = Object.values(layers).filter((l) => l.domain === domain.id);
    return { ...domain, layers: domainLayers };
  }).filter((d) => d.layers.length > 0);

  const activeLayerCount = Object.values(layers).filter((l) => l.visible).length;

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
        className="absolute left-4 top-1/2 -translate-y-1/2 z-40 p-3 bg-[#0a0f14]/90 backdrop-blur-md border border-cyan-900/30 rounded-xl hover:border-cyan-700/50 transition-colors group"
      >
        <Layers className="w-5 h-5 text-cyan-600 group-hover:text-cyan-400 transition-colors" />
        {activeLayerCount > 0 && (
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-cyan-500 rounded-full flex items-center justify-center">
            <span className="text-[8px] text-black font-bold">{activeLayerCount}</span>
          </div>
        )}
      </button>
    );
  }

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-40 w-72 pointer-events-auto">
      <div className="bg-[#0a0f14]/90 backdrop-blur-md border border-cyan-900/30 rounded-2xl shadow-2xl shadow-cyan-950/20 max-h-[70vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 pb-3 border-b border-cyan-900/30 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-500" />
            <span className="text-[10px] tracking-[0.3em] uppercase text-cyan-500 font-mono">
              Data Layers
            </span>
            {activeLayerCount > 0 && (
              <span className="px-1.5 py-0.5 bg-cyan-900/50 rounded text-[9px] text-cyan-300 font-mono">
                {activeLayerCount}
              </span>
            )}
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 hover:bg-cyan-950/50 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5 text-cyan-700 hover:text-cyan-400" />
          </button>
        </div>

        {/* 검색 */}
        <div className="px-4 py-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-800" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search layers..."
              className="w-full bg-cyan-950/30 border border-cyan-900/30 rounded-lg pl-8 pr-3 py-2 text-[11px] text-cyan-300 placeholder-cyan-800 focus:outline-none focus:border-cyan-700/50 font-mono"
            />
          </div>
        </div>

        {/* 레이어 목록 */}
        <div className="overflow-y-auto px-3 pb-3 flex-1 no-scrollbar">
          {filteredDomains.length === 0 ? (
            <div className="text-center py-8 text-cyan-800 text-[11px] font-mono">
              {searchQuery ? 'No layers found' : 'No layers registered'}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredDomains.map((domain) => {
                const isExpanded = expandedDomains.has(domain.id);
                const activeDomainLayers = domain.layers.filter((l) => l.visible).length;

                return (
                  <div key={domain.id}>
                    {/* 도메인 헤더 */}
                    <button
                      onClick={() => toggleDomain(domain.id)}
                      className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-cyan-950/30 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        {(() => {
                          const Icon = DOMAIN_ICONS[domain.id];
                          return <Icon className="w-3.5 h-3.5" style={{ color: domain.color }} />;
                        })()}
                        <span className="text-[11px] text-cyan-400 tracking-wider font-mono">
                          {domain.nameKo}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {activeDomainLayers > 0 && (
                          <span className="px-1.5 py-0.5 bg-cyan-800/30 rounded text-[8px] text-cyan-400 font-mono">
                            {activeDomainLayers}/{domain.layers.length}
                          </span>
                        )}
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-cyan-700" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-cyan-700" />
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
                            {domain.layers.map((layer) => (
                              <LayerItem
                                key={layer.id}
                                layer={layer}
                                onToggle={() => toggleLayer(layer.id)}
                              />
                            ))}
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

function LayerItem({ layer, onToggle }: { layer: LayerConfig; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between p-2 rounded-lg transition-all duration-200 ${
        layer.visible
          ? 'bg-cyan-950/40 border border-cyan-800/40'
          : 'hover:bg-cyan-950/20 border border-transparent'
      }`}
    >
      <span
        className={`text-[10px] tracking-wider font-mono ${
          layer.visible ? 'text-cyan-300' : 'text-cyan-700'
        }`}
      >
        {layer.name}
      </span>
      <div
        className={`w-7 h-3.5 rounded-full p-0.5 transition-colors ${
          layer.visible ? 'bg-cyan-700' : 'bg-slate-800'
        }`}
      >
        <div
          className={`w-2.5 h-2.5 rounded-full transition-transform ${
            layer.visible
              ? 'translate-x-3 bg-cyan-400 shadow-[0_0_6px_rgba(0,240,255,0.8)]'
              : 'translate-x-0 bg-slate-600'
          }`}
        />
      </div>
    </button>
  );
}
