'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import dynamic from 'next/dynamic';
import {
  ShieldAlert,
  Globe,
  RotateCcw,
} from 'lucide-react';
import { useAppStore } from '@/stores/app-store';
import { useDomainLayers } from '@/hooks/useDomainLayers';
import { useAircraftLayer } from '@/hooks/useAircraftLayer';
import { useShipLayer } from '@/hooks/useShipLayer';
import { useTrainLayer } from '@/hooks/useTrainLayer';
import { useCyberDefenseLayer } from '@/hooks/useCyberDefenseLayer';
import { useCrowdLayer } from '@/hooks/useCrowdLayer';
import { useTrafficFlowLayer } from '@/hooks/useTrafficFlowLayer';
import { useWeatherLayer } from '@/hooks/useWeatherLayer';
import { useDisasterLayer } from '@/hooks/useDisasterLayer';
import { useHealthLayer } from '@/hooks/useHealthLayer';
import { useVulnerableLayer } from '@/hooks/useVulnerableLayer';
import { useDispatchLayer } from '@/hooks/useDispatchLayer';
import { useSelectedObjectBinding } from '@/hooks/useSelectedObjectBinding';
import { useNoFlyZonesLayer } from '@/hooks/useNoFlyZonesLayer';
import { useCctvLayer } from '@/hooks/useCctvLayer';
import LayerPanel from '@/components/panels/LayerPanel';
import StatusPanel from '@/components/panels/StatusPanel';
import AlertEngine from '@/components/alert/AlertEngine';
import AlertDashboard from '@/components/panels/AlertDashboard';
import WarningOverlay from '@/components/alert/WarningOverlay';
import DataPipelineStatus from '@/components/alert/DataPipelineStatus';
import Team2LayerBootstrap from '@/components/data/Team2LayerBootstrap';

// Mapbox GL은 SSR 불가 → dynamic import
const MapCanvas = dynamic(() => import('@/components/map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 bg-[#050505] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

// 도시별 좌표
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

export default function Page() {
  const [time, setTime] = useState('');
  const [showIntro, setShowIntro] = useState(true);
  const [activeLocation, setActiveLocation] = useState('');
  const flyTo = useAppStore((s) => s.flyTo);
  const resetCamera = useAppStore((s) => s.resetCamera);
  const camera = useAppStore((s) => s.camera);
  const activeDomainCount = useAppStore(
    (s) => new Set(Object.values(s.layers).filter((layer) => layer.visible).map((layer) => layer.domain)).size
  );

  // Phase 2: 정적 도메인 레이어 등록
  useDomainLayers();

  // Phase 3: 실시간 이동체 시뮬레이션
  useAircraftLayer();
  useShipLayer();
  useTrainLayer();
  useCyberDefenseLayer();
  useCrowdLayer();
  useTrafficFlowLayer();
  useWeatherLayer();
  useDisasterLayer();
  useHealthLayer();
  useVulnerableLayer();
  useDispatchLayer();
  useSelectedObjectBinding();
  useNoFlyZonesLayer();
  useCctvLayer();

  // 실시간 시계
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toISOString().replace('T', ' ').substring(0, 19) + 'Z');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // 인트로
  useEffect(() => {
    if (!showIntro) return;
    const timer = setTimeout(() => {
      setShowIntro(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [showIntro]);

  // 도시 클릭 → flyTo
  const handleLocationClick = useCallback(
    (loc: (typeof LOCATIONS)[number]) => {
      setActiveLocation(loc.name);
      flyTo(loc.lat, loc.lng, loc.zoom);
    },
    [flyTo]
  );

  // 전국 뷰 복귀
  const handleResetView = useCallback(() => {
    setActiveLocation('');
    resetCamera();
  }, [resetCamera]);

  return (
    <>
      {/* ===== 인트로 스크린 ===== */}
      <AnimatePresence>
        {showIntro && (
          <motion.div
            key="intro"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#050505]"
          >
            <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:40px_40px]" />
            <div className="absolute w-[400px] h-[400px] pointer-events-none flex items-center justify-center opacity-20">
              <div className="absolute w-full h-full border border-cyan-500 rounded-full border-dashed animate-[spin_10s_linear_infinite]" />
              <div className="absolute w-[75%] h-[75%] border-2 border-cyan-500 rounded-full border-t-transparent animate-[spin_7s_linear_infinite_reverse] opacity-50" />
            </div>
            <div className="flex flex-col items-center gap-6 z-10">
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: 'backOut' }}
              >
                <ShieldAlert size={48} className="text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)]" />
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 20, letterSpacing: '0.2em' }}
                animate={{ opacity: 1, y: 0, letterSpacing: '0.08em' }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="text-5xl md:text-6xl font-bold text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)] tracking-[0.08em] font-mono"
              >
                SYSTEM INITIALIZING
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.8 }}
                className="text-sm tracking-[0.4em] text-cyan-500/60 uppercase font-mono"
              >
                TENMO 3D MAP KOREA
              </motion.p>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="w-64 h-1 bg-cyan-950/50 rounded-full overflow-hidden mt-4"
              >
                <motion.div
                  className="h-full bg-cyan-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 2, delay: 0.5, ease: 'easeInOut' }}
                />
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 메인 관제 화면 ===== */}
      {!showIntro && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="h-screen w-screen bg-[#050505] text-cyan-500 font-mono overflow-hidden relative selection:bg-cyan-900/50"
        >
          {/* 2팀: 공공데이터 파이프라인 */}
          <Team2LayerBootstrap />

          {/* 3D 지도 (최하단 레이어) */}
          <MapCanvas />

          {/* 2팀: critical 경보 오버레이 */}
          <WarningOverlay />

          {/* CRT 스캔라인 오버레이 */}
          <div className="pointer-events-none absolute inset-0 z-[60] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.15)_50%),linear-gradient(90deg,rgba(255,0,0,0.04),rgba(0,255,0,0.015),rgba(0,0,255,0.04))] bg-[length:100%_4px,3px_100%] opacity-30 mix-blend-overlay" />

          {/* 비네트 */}
          <div className="pointer-events-none absolute inset-0 z-[55] bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.6)_100%)]" />

          {/* ===== HUD 상단 바 ===== */}
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

          {/* ===== 좌측 레이어 패널 (1팀) ===== */}
          <LayerPanel />

          {/* ===== 우측 상태 패널 (2팀) ===== */}
          <StatusPanel />

          {/* ===== 경보 배너 엔진 (2팀) ===== */}
          <AlertEngine />

          {/* ===== 경보 대시보드 (2팀 Phase4) ===== */}
          <AlertDashboard />

          {/* ===== 데이터 파이프라인 상태 (2팀 Phase4) ===== */}
          <DataPipelineStatus />

          {/* ===== 하단 도시 네비게이션 바 ===== */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 pointer-events-auto">
            {/* 전국 뷰 복귀 버튼 */}
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

            {/* 도시 바 */}
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

            {/* 현위치 십자선 */}
            <button
              onClick={handleResetView}
              className="p-2 bg-[#0a0f14]/80 backdrop-blur-md border border-cyan-900/30 rounded-full text-cyan-700 hover:text-cyan-400 hover:border-cyan-700/40 transition-all"
              title="Reset View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </>
  );
}
