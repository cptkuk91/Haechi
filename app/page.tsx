'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plane,
  Activity,
  Satellite,
  Car,
  CloudRain,
  Video,
  ChevronDown,
  MapPin,
  Moon,
  Sun,
  Radio,
  Navigation,
  Eye,
  Cpu,
  Monitor,
  Crosshair,
  Settings2,
  Layers,
  ShieldAlert
} from 'lucide-react';
import Image from 'next/image';

export default function Page() {
  const [time, setTime] = useState('');
  const [showIntro, setShowIntro] = useState(true);
  const showIntroCompleted = useRef(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toISOString().replace('T', ' ').substring(0, 19) + 'Z');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // One-time intro after load
  useEffect(() => {
    if (!showIntro) return;
    const timer = setTimeout(() => {
      showIntroCompleted.current = true;
      setShowIntro(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [showIntro]);

  const layers = [
    { id: 'flights', name: 'Live Flights', icon: Plane, value: '2.8k', active: true },
    { id: 'earthquakes', name: 'Earthquakes (24h)', icon: Activity, value: '7', active: false },
    { id: 'satellites', name: 'Satellites', icon: Satellite, value: '198', active: true },
    { id: 'traffic', name: 'Street Traffic', icon: Car, value: '84%', active: false },
    { id: 'weather', name: 'Weather Radar', icon: CloudRain, value: '', active: false },
    { id: 'cctv', name: 'CCTV Mesh', icon: Video, value: '1.2m', active: false },
  ];

  const locations = [
    'Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon', 'Gwangju', 'Ulsan', 'Jeju'
  ];

  const modes = [
    { id: 'normal', name: 'Normal', icon: Sun },
    { id: 'crt', name: 'CRT', icon: Monitor },
    { id: 'nvg', name: 'NVG', icon: Moon },
    { id: 'flir', name: 'FLIR', icon: Sun }, 
    { id: 'radar', name: 'Radar', icon: Radio },
    { id: 'nav', name: 'Nav', icon: Navigation },
    { id: 'show', name: 'Show', icon: Eye },
    { id: 'ai', name: 'AI', icon: Cpu },
  ];

  const [activeLocation, setActiveLocation] = useState('Seoul');
  const [activeMode, setActiveMode] = useState('crt');
  const [activeLayers, setActiveLayers] = useState<string[]>(['flights', 'satellites']);

  const toggleLayer = (id: string) => {
    setActiveLayers(prev => 
      prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
    );
  };

  return (
    <>
      <AnimatePresence>
        {showIntro && (
          <motion.div
            key="intro"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#050505]"
          >
            {/* Background grid */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.03)_1px,transparent_1px)] bg-[size:40px_40px]" />

            {/* Holographic ring */}
            <div className="absolute w-[400px] h-[400px] pointer-events-none flex items-center justify-center opacity-20">
              <div className="absolute w-full h-full border border-cyan-500 rounded-full border-dashed animate-[spin_10s_linear_infinite]" />
              <div className="absolute w-[75%] h-[75%] border-2 border-cyan-500 rounded-full border-t-transparent animate-[spin_7s_linear_infinite_reverse] opacity-50" />
            </div>

            <div className="flex flex-col items-center gap-6 z-10">
              {/* Shield icon */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: 'backOut' }}
              >
                <ShieldAlert size={48} className="text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)]" />
              </motion.div>

              {/* Title text */}
              <motion.h1
                initial={{ opacity: 0, y: 20, letterSpacing: '0.2em' }}
                animate={{ opacity: 1, y: 0, letterSpacing: '0.08em' }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="text-5xl md:text-6xl font-bold text-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.8)] tracking-[0.08em] font-mono"
              >
                SYSTEM INITIALIZING
              </motion.h1>

              {/* Subtitle */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.8 }}
                className="text-sm tracking-[0.4em] text-cyan-500/60 uppercase font-mono"
              >
                TENMO 3D MAP KOREA
              </motion.p>

              {/* Loading bar */}
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

      {!showIntro && (
        <motion.div
          initial={showIntroCompleted.current ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="min-h-screen bg-[#050505] text-cyan-500 font-mono overflow-hidden relative selection:bg-cyan-900/50"
        >
          {/* CRT Scanline Overlay */}
          <div className="pointer-events-none absolute inset-0 z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%] opacity-20 mix-blend-overlay"></div>
          
          {/* Vignette */}
          <div className="pointer-events-none absolute inset-0 z-40 bg-[radial-gradient(circle_at_center,transparent_0%,#000_100%)] opacity-80"></div>

          {/* Header */}
          <header className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start z-40 pointer-events-none">
            <div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] animate-pulse"></div>
                <h1 className="text-3xl font-bold tracking-[0.3em] text-white">WORLDVIEW</h1>
              </div>
              <div className="text-[10px] mt-3 text-cyan-700/80 tracking-widest uppercase space-y-1">
                <p>TOP SECRET // SI-TK // NOFORN</p>
                <p>GRID-4186 OPR-4117</p>
                <p className="text-cyan-400/80 mt-2 font-bold text-xs">CRT</p>
              </div>
            </div>
            
            <div className="text-right text-[10px] text-cyan-700/80 tracking-widest uppercase space-y-1">
              <div className="flex items-center justify-end gap-2 text-red-500 mb-2">
                <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse"></div>
                <p>REC {time}</p>
              </div>
              <p>ORB: 47438 PASS: DESC-179</p>
              <p className="mt-4">SYS: ONLINE</p>
            </div>
          </header>

          {/* Center Core HUD */}
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            
            {/* Main Central Ring System */}
            <div className="relative w-[600px] h-[600px] flex items-center justify-center">
              
              {/* Outer Orbit (Dashed) */}
              <motion.div 
                className="absolute w-[560px] h-[560px] border-2 border-cyan-800/40 rounded-full border-dashed"
                animate={{ rotate: 360 }}
                transition={{ duration: 70, repeat: Infinity, ease: "linear" }}
              />

              {/* Middle Orbit (Solid with gaps) */}
              <motion.div 
                className="absolute w-[440px] h-[440px] rounded-full"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 0deg 40deg, rgba(34, 211, 238, 0.4) 40deg 140deg, transparent 140deg 220deg, rgba(34, 211, 238, 0.4) 220deg 320deg, transparent 320deg 360deg)',
                  maskImage: 'radial-gradient(transparent 68%, black 69%)',
                  WebkitMaskImage: 'radial-gradient(transparent 68%, black 69%)',
                }}
                animate={{ rotate: -360 }}
                transition={{ duration: 55, repeat: Infinity, ease: "linear" }}
              />

              {/* Inner Core Glow Ring */}
              <div className="absolute w-[340px] h-[340px] rounded-full border-[3px] border-cyan-400/80 shadow-[0_0_50px_rgba(34,211,238,0.25)] bg-cyan-950/20 backdrop-blur-md flex flex-col items-center justify-center">
                
                <h3 className="text-xs tracking-[0.4em] text-cyan-500/80 mb-2">CORE CLOCK</h3>
                
                {/* Digital Clock */}
                <div className="text-5xl font-bold text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,0.8)] tracking-widest font-mono my-3">
                  {new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
                
                {/* Date */}
                <div className="text-sm tracking-widest text-cyan-500 mt-2 font-mono">
                  {new Date().toISOString().split('T')[0]} KST
                </div>

                {/* Status Indicator */}
                <div className="mt-6 flex items-center gap-2 bg-cyan-950/60 border border-cyan-800/50 px-4 py-1.5 rounded-full backdrop-blur-sm">
                  <ShieldAlert className="w-4 h-4 text-cyan-400" />
                  <span className="text-[11px] tracking-widest text-cyan-300">SYSTEM ONLINE</span>
                </div>
              </div>

              {/* Orbiting Satellites (Data points) */}
              
              {/* Top Right: Memory */}
              <div className="absolute top-[8%] right-[15%] flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)] mb-2"></div>
                <div className="bg-cyan-950/80 border border-cyan-800/50 px-3 py-1.5 rounded flex flex-col items-center backdrop-blur-sm">
                  <span className="text-[9px] text-cyan-500 tracking-widest leading-tight">MEM.ALLOC</span>
                  <span className="text-xs text-cyan-300 font-bold leading-tight mt-0.5">45%</span>
                </div>
              </div>

              {/* Bottom Right: Network */}
              <div className="absolute bottom-[8%] right-[15%] flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)] mb-2"></div>
                <div className="bg-cyan-950/80 border border-cyan-800/50 px-3 py-1.5 rounded flex flex-col items-center backdrop-blur-sm">
                  <span className="text-[9px] text-cyan-500 tracking-widest leading-tight">NET.UPLINK</span>
                  <span className="text-xs text-cyan-300 font-bold leading-tight mt-0.5">1.2TB/s</span>
                </div>
              </div>

              {/* Far Right: Sys Diag */}
              <div className="absolute right-[-8%] top-1/2 -translate-y-1/2 flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)] mb-2"></div>
                <div className="bg-cyan-950/80 border border-cyan-800/50 px-3 py-1.5 rounded flex flex-col items-center backdrop-blur-sm">
                  <span className="text-[9px] text-cyan-500 tracking-widest leading-tight">SYS.DIAG</span>
                  <span className="text-xs text-cyan-300 font-bold leading-tight mt-0.5">98%</span>
                </div>
              </div>

              {/* Top Left: AI Core */}
              <div className="absolute top-[18%] left-[2%] flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)] mb-2"></div>
                <div className="bg-cyan-950/80 border border-cyan-800/50 px-3 py-1.5 rounded flex flex-col items-center backdrop-blur-sm">
                  <span className="text-[9px] text-cyan-500 tracking-widest leading-tight">AI.CORE</span>
                  <span className="text-xs text-cyan-300 font-bold leading-tight mt-0.5">SYNCED</span>
                </div>
              </div>

              {/* Bottom Left: FireWall */}
              <div className="absolute bottom-[18%] left-[2%] flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)] mb-2"></div>
                <div className="bg-cyan-950/80 border border-cyan-800/50 px-3 py-1.5 rounded flex flex-col items-center backdrop-blur-sm">
                  <span className="text-[9px] text-cyan-500 tracking-widest leading-tight">SEC.FIREWALL</span>
                  <span className="text-xs text-cyan-300 font-bold leading-tight mt-0.5">ACTIVE</span>
                </div>
              </div>

              {/* Connection Line to Weather */}
              <div className="absolute right-[calc(50%+170px)] w-[160px] h-[2px] bg-gradient-to-l from-cyan-400/80 to-cyan-800/20 top-1/2" />

              {/* Weather Panel (Connected to Left Line) */}
              <div className="absolute right-[calc(50%+330px)] top-1/2 -translate-y-1/2 border border-cyan-800/60 bg-cyan-950/40 backdrop-blur-md p-4 rounded-xl w-[200px] pointer-events-auto shadow-[0_0_30px_rgba(8,145,178,0.15)]">
                <div className="flex items-center gap-3 mb-4 border-b border-cyan-800/50 pb-3">
                  <CloudRain className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs tracking-widest uppercase text-cyan-500">Weather</span>
                </div>
                <div className="flex justify-between items-end mb-2">
                  <span className="text-3xl font-bold text-cyan-300">2°C</span>
                  <span className="text-[10px] text-cyan-600 tracking-widest mb-1">CURRENT</span>
                </div>
                <p className="text-sm text-cyan-400/80 mb-4 font-bold">Partly Cloudy</p>
                <div className="flex justify-between text-xs text-cyan-600 border-t border-cyan-800/30 pt-3">
                  <span>Mar 1</span>
                  <span>10° / 0°</span>
                </div>
              </div>

            </div>
          </div>

          {/* Left Panel (Layers) */}
          <div className="hidden md:block absolute left-6 top-1/2 -translate-y-1/2 w-72 z-40 pointer-events-auto">
            <div className="bg-[#0a0f14]/80 backdrop-blur-md border border-cyan-900/30 rounded-2xl p-5 shadow-2xl">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-cyan-900/30">
                <div className="flex items-center gap-2 text-cyan-600">
                  <Layers className="w-4 h-4" />
                  <span className="text-xs tracking-widest uppercase">Data Layers</span>
                </div>
                <Settings2 className="w-4 h-4 text-cyan-800 hover:text-cyan-400 cursor-pointer transition-colors" />
              </div>
              
              <div className="space-y-1">
                {layers.map((layer) => {
                  const isActive = activeLayers.includes(layer.id);
                  return (
                    <button
                      key={layer.id}
                      onClick={() => toggleLayer(layer.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg transition-all duration-200 ${
                        isActive 
                          ? 'bg-cyan-950/40 border border-cyan-800/50 text-cyan-300' 
                          : 'hover:bg-cyan-950/20 border border-transparent text-cyan-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <layer.icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-cyan-800'}`} />
                        <span className="text-xs tracking-wider">{layer.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {layer.value && (
                          <span className={`text-[10px] ${isActive ? 'text-cyan-500' : 'text-cyan-800'}`}>
                            {layer.value}
                          </span>
                        )}
                        <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${isActive ? 'bg-cyan-800' : 'bg-slate-800'}`}>
                          <div className={`w-3 h-3 rounded-full bg-cyan-400 transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0 opacity-30'}`} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Panel (Controls) */}
          <div className="hidden md:block absolute right-6 top-1/2 -translate-y-1/2 w-72 z-40">
            <div className="bg-[#0a0f14]/80 backdrop-blur-md border border-cyan-900/30 rounded-2xl p-5 shadow-2xl">
              <div className="space-y-6">
                {/* Slider Control */}
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] tracking-widest text-cyan-600 uppercase">
                    <span>Bloom</span>
                    <span className="text-cyan-400">100%</span>
                  </div>
                  <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500 w-full"></div>
                  </div>
                </div>

                {/* Slider Control */}
                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] tracking-widest text-cyan-600 uppercase">
                    <span>Sharpen</span>
                    <span className="text-cyan-400">68%</span>
                  </div>
                  <div className="h-1 w-full bg-slate-800 rounded-full relative">
                    <div className="absolute h-full bg-cyan-500 w-[68%] rounded-full"></div>
                    <div className="absolute w-3 h-3 bg-cyan-300 rounded-full top-1/2 -translate-y-1/2 left-[68%] -translate-x-1.5 shadow-[0_0_10px_rgba(34,211,238,0.5)]"></div>
                  </div>
                </div>

                {/* Dropdown */}
                <div className="space-y-3">
                  <div className="text-[10px] tracking-widest text-cyan-600 uppercase">HUD</div>
                  <button className="w-full flex items-center justify-between p-3 bg-cyan-950/30 border border-cyan-900/50 rounded-lg text-xs text-cyan-400 hover:bg-cyan-950/50 transition-colors">
                    <span>Tactical</span>
                    <ChevronDown className="w-4 h-4 text-cyan-700" />
                  </button>
                </div>

                {/* Toggle */}
                <div className="flex items-center justify-between p-3 bg-cyan-950/20 border border-cyan-900/30 rounded-lg text-xs transition-colors">
                  <span className="tracking-widest uppercase text-cyan-600">Panoptic</span>
                  <button className="flex items-center gap-2 bg-cyan-950/60 border border-cyan-800/50 px-3 py-1.5 rounded text-cyan-300">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]"></div>
                    <span className="text-[10px]">ON</span>
                  </button>
                </div>

                {/* Slider Control */}
                <div className="space-y-3 pt-4 border-t border-cyan-900/30">
                  <div className="flex justify-between text-[10px] tracking-widest text-cyan-600 uppercase">
                    <span>Resolution</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-full bg-slate-800 rounded-full relative">
                      <div className="absolute h-full bg-cyan-500 w-[85%] rounded-full"></div>
                      <div className="absolute w-3 h-3 bg-cyan-300 rounded-full top-1/2 -translate-y-1/2 left-[85%] -translate-x-1.5"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Telemetry Data */}
            <div className="mt-4 text-[10px] text-cyan-700/80 tracking-widest uppercase text-right space-y-1">
              <p>GSG: 4.62M NING: 2.9</p>
              <p>ALT: 105M SUN: -30.8° EL</p>
            </div>
          </div>

          {/* Bottom Panel */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-4 w-full max-w-4xl px-4">
            
            {/* Locations Bar */}
            <div className="flex items-center gap-2 bg-[#0a0f14]/80 backdrop-blur-md border border-cyan-900/30 rounded-full p-1.5 px-4 overflow-x-auto w-full max-w-3xl no-scrollbar">
              <div className="flex items-center gap-2 text-cyan-600 pr-4 border-r border-cyan-900/50">
                <MapPin className="w-3 h-3" />
                <span className="text-[9px] uppercase tracking-widest whitespace-nowrap">US Capitol</span>
              </div>
              <div className="flex gap-1 pl-2 overflow-x-auto no-scrollbar">
                {locations.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setActiveLocation(loc)}
                    className={`px-4 py-1.5 rounded-full text-[10px] tracking-wider whitespace-nowrap transition-all ${
                      activeLocation === loc 
                        ? 'bg-cyan-900/50 text-cyan-300 border border-cyan-700/50' 
                        : 'text-cyan-700 hover:text-cyan-400 hover:bg-cyan-950/30 border border-transparent'
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>

            {/* View Modes Bar */}
            <div className="flex items-center gap-1 bg-[#0a0f14]/90 backdrop-blur-md border border-cyan-900/40 rounded-2xl p-2">
              {modes.map((mode) => {
                const isActive = activeMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setActiveMode(mode.id)}
                    className={`flex flex-col items-center gap-1.5 p-3 min-w-[72px] rounded-xl transition-all duration-200 ${
                      isActive 
                        ? 'bg-cyan-950/60 border border-cyan-700/50 text-cyan-300 shadow-[inset_0_0_20px_rgba(8,145,178,0.2)]' 
                        : 'text-cyan-800 hover:text-cyan-500 hover:bg-cyan-950/30 border border-transparent'
                    }`}
                  >
                    <mode.icon className={`w-5 h-5 ${isActive ? 'text-cyan-400' : ''}`} />
                    <span className="text-[9px] uppercase tracking-widest">{mode.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
}
