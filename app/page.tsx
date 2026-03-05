'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import dynamic from 'next/dynamic';
import LayerBootstrap from '@/components/boot/LayerBootstrap';
import IntroScreen from '@/components/intro/IntroScreen';
import HudHeader from '@/components/hud/HudHeader';
import CityNavBar from '@/components/hud/CityNavBar';
import LayerPanel from '@/components/panels/LayerPanel';
import StatusPanel from '@/components/panels/StatusPanel';
import AlertEngine from '@/components/alert/AlertEngine';
import AlertDashboard from '@/components/panels/AlertDashboard';
import WarningOverlay from '@/components/alert/WarningOverlay';
import DataPipelineStatus from '@/components/alert/DataPipelineStatus';
import Team2LayerBootstrap from '@/components/data/Team2LayerBootstrap';
import TrafficCctvVideoPanel from '@/components/map/TrafficCctvVideoPanel';

const MapCanvas = dynamic(() => import('@/components/map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 bg-[#050505] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

export default function Page() {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    if (!showIntro) return;
    const timer = setTimeout(() => setShowIntro(false), 3000);
    return () => clearTimeout(timer);
  }, [showIntro]);

  return (
    <>
      <LayerBootstrap />
      <IntroScreen visible={showIntro} />

      {!showIntro && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="h-screen w-screen bg-[#050505] text-cyan-500 font-mono overflow-hidden relative selection:bg-cyan-900/50"
        >
          <Team2LayerBootstrap />
          <MapCanvas />
          <TrafficCctvVideoPanel />
          <WarningOverlay />

          {/* CRT scanline overlay */}
          <div className="pointer-events-none absolute inset-0 z-[60] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.15)_50%),linear-gradient(90deg,rgba(255,0,0,0.04),rgba(0,255,0,0.015),rgba(0,0,255,0.04))] bg-[length:100%_4px,3px_100%] opacity-30 mix-blend-overlay" />

          {/* Vignette */}
          <div className="pointer-events-none absolute inset-0 z-[55] bg-[radial-gradient(circle_at_center,transparent_30%,rgba(0,0,0,0.6)_100%)]" />

          <HudHeader />
          <LayerPanel />
          <StatusPanel />
          <AlertEngine />
          <AlertDashboard />
          <DataPipelineStatus />
          <CityNavBar />
        </motion.div>
      )}
    </>
  );
}
