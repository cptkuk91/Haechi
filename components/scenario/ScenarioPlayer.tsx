'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, Square, ChevronDown, ChevronUp, Film } from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { ScenarioEngine, PRESET_SCENARIOS, type EngineState, type Scenario } from '@/lib/scenario-engine';

export default function ScenarioPlayer() {
  const [expanded, setExpanded] = useState(false);
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [progress, setProgress] = useState(0);
  const [activeScenario, setActiveScenario] = useState<Scenario | null>(null);

  const store = useAppStore();
  const engineRef = useRef<ScenarioEngine | null>(null);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 엔진 초기화
  useEffect(() => {
    const engine = new ScenarioEngine({
      flyTo: store.flyTo,
      toggleLayer: store.toggleLayer,
      triggerAlert: store.triggerAlert,
      selectObject: store.selectObject,
      addLayer: store.addLayer,
    });

    engine.setOnStateChange((state, p) => {
      setEngineState(state);
      setProgress(p);
      if (state === 'idle') {
        setActiveScenario(null);
        if (progressRef.current) {
          clearInterval(progressRef.current);
          progressRef.current = null;
        }
      }
    });

    engineRef.current = engine;
    return () => {
      engine.stop();
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [store.flyTo, store.toggleLayer, store.triggerAlert, store.selectObject, store.addLayer]);

  // 프로그레스 업데이트
  useEffect(() => {
    if (engineState === 'playing') {
      progressRef.current = setInterval(() => {
        if (engineRef.current) {
          setProgress(engineRef.current.getProgress());
        }
      }, 200);
    } else {
      if (progressRef.current) {
        clearInterval(progressRef.current);
        progressRef.current = null;
      }
    }
    return () => {
      if (progressRef.current) clearInterval(progressRef.current);
    };
  }, [engineState]);

  const handlePlay = useCallback((scenario: Scenario) => {
    if (!engineRef.current) return;
    setActiveScenario(scenario);
    engineRef.current.play(scenario);
  }, []);

  const handlePause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const handleResume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  const handleStop = useCallback(() => {
    engineRef.current?.stop();
    setActiveScenario(null);
  }, []);

  return (
    <div className="absolute bottom-16 right-4 z-[70] pointer-events-auto">
      {/* 토글 버튼 */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 px-3 py-2 bg-[#0a0f14]/90 backdrop-blur-md border border-cyan-900/30 rounded-xl hover:border-cyan-700/50 transition-colors group"
        >
          <Film className="w-4 h-4 text-cyan-600 group-hover:text-cyan-400" />
          <span className="text-[10px] tracking-widest text-cyan-600 group-hover:text-cyan-400 uppercase font-mono">
            Scenarios
          </span>
          {engineState !== 'idle' && (
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          )}
        </button>
      )}

      {/* 패널 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-80 bg-[#0a0f14]/95 backdrop-blur-md border border-cyan-900/30 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-900/30">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-cyan-500" />
                <span className="text-[10px] tracking-[0.3em] uppercase text-cyan-500 font-mono">
                  Scenario Engine
                </span>
              </div>
              <button onClick={() => setExpanded(false)} className="p-1 hover:bg-cyan-950/50 rounded">
                <ChevronDown className="w-3.5 h-3.5 text-cyan-700" />
              </button>
            </div>

            {/* 재생 중인 시나리오 */}
            {activeScenario && (
              <div className="px-4 py-3 border-b border-cyan-900/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] text-cyan-300 font-mono">{activeScenario.nameKo}</span>
                  <span className="text-[9px] text-cyan-700 font-mono">
                    {Math.round(progress * 100)}%
                  </span>
                </div>

                {/* 프로그레스 바 */}
                <div className="w-full h-1.5 bg-cyan-950/50 rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-cyan-500 rounded-full transition-all duration-200"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>

                {/* 컨트롤 */}
                <div className="flex items-center gap-2">
                  {engineState === 'playing' ? (
                    <button
                      onClick={handlePause}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-900/40 border border-cyan-800/40 rounded-lg text-cyan-300 hover:bg-cyan-900/60 transition-colors"
                    >
                      <Pause className="w-3 h-3" />
                      <span className="text-[9px] tracking-wider font-mono">PAUSE</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleResume}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-900/40 border border-cyan-800/40 rounded-lg text-cyan-300 hover:bg-cyan-900/60 transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      <span className="text-[9px] tracking-wider font-mono">RESUME</span>
                    </button>
                  )}
                  <button
                    onClick={handleStop}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/40 border border-red-800/30 rounded-lg text-red-400 hover:bg-red-950/60 transition-colors"
                  >
                    <Square className="w-3 h-3" />
                    <span className="text-[9px] tracking-wider font-mono">STOP</span>
                  </button>
                </div>
              </div>
            )}

            {/* 시나리오 목록 */}
            <div className="px-3 py-2 max-h-60 overflow-y-auto no-scrollbar">
              <div className="space-y-1">
                {PRESET_SCENARIOS.map((scenario) => {
                  const isActive = activeScenario?.id === scenario.id;
                  return (
                    <button
                      key={scenario.id}
                      onClick={() => !isActive && handlePlay(scenario)}
                      disabled={isActive}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        isActive
                          ? 'bg-cyan-950/50 border border-cyan-700/40'
                          : 'hover:bg-cyan-950/30 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-mono ${isActive ? 'text-cyan-300' : 'text-cyan-500'}`}>
                          {scenario.nameKo}
                        </span>
                        {!isActive && (
                          <Play className="w-3 h-3 text-cyan-700" />
                        )}
                        {isActive && (
                          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                        )}
                      </div>
                      <p className="text-[9px] text-cyan-800 mt-1 font-mono">{scenario.description}</p>
                      <p className="text-[8px] text-cyan-900 mt-0.5 font-mono">
                        {(scenario.duration / 1000).toFixed(0)}s / {scenario.events.length} events
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
