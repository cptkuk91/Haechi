'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { useAppStore } from '@/stores/app-store';
import { MAPBOX_STYLE } from '@/styles/theme';
import { buildDeckLayer, type BuildContext } from '@/lib/layer-builder';
import { getMapBounds } from '@/lib/viewport-utils';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

// 레이어 업데이트 최소 간격 (ms)
const LAYER_THROTTLE_MS = 50;
// 뷰포트 변경 디바운스 (ms)
const VIEWPORT_DEBOUNCE_MS = 100;

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showFPS, setShowFPS] = useState(false);

  const { layers, camera, setCamera, setMapBounds } = useAppStore();

  // 성능 추적 ref
  const lastLayerUpdate = useRef(0);
  const pendingRAF = useRef<number | null>(null);
  const viewportDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fpsRef = useRef({ frames: 0, lastTime: performance.now(), fps: 0 });
  const fpsDisplayRef = useRef<HTMLDivElement>(null);
  const buildContextRef = useRef<BuildContext>({
    zoom: camera.zoom,
    bounds: { west: 124, south: 33, east: 132, north: 39 },
  });

  // Worker ref
  const workerRef = useRef<Worker | null>(null);

  // Web Worker 초기화
  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('../../workers/geo-filter.worker.ts', import.meta.url)
      );
      workerRef.current = worker;
      return () => worker.terminate();
    } catch {
      // Worker 지원 안 되는 환경 → 메인 스레드 fallback
      return;
    }
  }, []);

  // FPS 카운터
  useEffect(() => {
    if (!showFPS) return;

    let animId: number;
    const tick = () => {
      const now = performance.now();
      fpsRef.current.frames++;
      if (now - fpsRef.current.lastTime >= 1000) {
        fpsRef.current.fps = fpsRef.current.frames;
        fpsRef.current.frames = 0;
        fpsRef.current.lastTime = now;
        if (fpsDisplayRef.current) {
          fpsDisplayRef.current.textContent = `${fpsRef.current.fps} FPS`;
        }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [showFPS]);

  // 뷰포트 컨텍스트 업데이트
  const updateBuildContext = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    buildContextRef.current = {
      zoom: map.getZoom(),
      bounds: getMapBounds(map),
    };
  }, []);

  // 지도 초기화
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (MAPBOX_TOKEN) {
      mapboxgl.accessToken = MAPBOX_TOKEN;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: [camera.longitude, camera.latitude],
      zoom: camera.zoom,
      pitch: 0,
      bearing: 0,
      antialias: true,
      projection: 'mercator',
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    // Deck.gl 오버레이
    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });
    map.addControl(overlay as unknown as mapboxgl.IControl);
    overlayRef.current = overlay;

    map.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: false }),
      'bottom-right'
    );

    map.on('load', () => {
      updateBuildContext();
      setMapBounds(getMapBounds(map));
      setMapLoaded(true);
    });

    // 카메라 이동 시 store 동기화 + 뷰포트 컨텍스트 업데이트
    map.on('moveend', () => {
      const center = map.getCenter();
      setCamera({
        latitude: center.lat,
        longitude: center.lng,
        zoom: map.getZoom(),
        pitch: 0,
        bearing: 0,
      });
      setMapBounds(getMapBounds(map));
      updateBuildContext();
    });

    // 뷰포트 변경 시 레이어 리필터 (디바운스)
    map.on('move', () => {
      if (viewportDebounce.current) clearTimeout(viewportDebounce.current);
      viewportDebounce.current = setTimeout(() => {
        updateBuildContext();
        scheduleDeckUpdate();
      }, VIEWPORT_DEBOUNCE_MS);
    });

    mapRef.current = map;

    return () => {
      if (viewportDebounce.current) clearTimeout(viewportDebounce.current);
      if (pendingRAF.current) cancelAnimationFrame(pendingRAF.current);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCamera, setMapBounds]);

  // 카메라 flyTo 반응
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const center = map.getCenter();
    const currentZoom = map.getZoom();

    const latDiff = Math.abs(center.lat - camera.latitude);
    const lngDiff = Math.abs(center.lng - camera.longitude);
    const zoomDiff = Math.abs(currentZoom - camera.zoom);

    if (latDiff > 0.001 || lngDiff > 0.001 || zoomDiff > 0.1) {
      map.flyTo({
        center: [camera.longitude, camera.latitude],
        zoom: camera.zoom,
        pitch: 0,
        bearing: 0,
        duration: 2000,
        essential: true,
      });
    }
  }, [camera.latitude, camera.longitude, camera.zoom, mapLoaded]);

  // RAF 기반 Deck.gl 레이어 업데이트 스케줄러
  const scheduleDeckUpdate = useCallback(() => {
    if (pendingRAF.current) return; // 이미 예약됨

    pendingRAF.current = requestAnimationFrame(() => {
      pendingRAF.current = null;

      const now = performance.now();
      if (now - lastLayerUpdate.current < LAYER_THROTTLE_MS) return;
      lastLayerUpdate.current = now;

      if (!overlayRef.current || !mapLoaded) return;

      const ctx = buildContextRef.current;
      const currentLayers = useAppStore.getState().layers;
      const visibleLayers = Object.values(currentLayers).filter((l) => l.visible && l.data);

      const deckLayers = visibleLayers
        .map((config) => buildDeckLayer(config, ctx))
        .filter(Boolean);

      overlayRef.current.setProps({ layers: deckLayers });
    });
  }, [mapLoaded]);

  // 레이어 데이터 변경 시 업데이트 스케줄
  useEffect(() => {
    if (!mapLoaded) return;
    scheduleDeckUpdate();
  }, [layers, mapLoaded, scheduleDeckUpdate]);

  // FPS 토글: Ctrl+Shift+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setShowFPS((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      {/* FPS 오버레이 (Ctrl+Shift+F) */}
      {showFPS && (
        <div
          ref={fpsDisplayRef}
          className="absolute top-14 left-1/2 -translate-x-1/2 z-[80] px-3 py-1 bg-black/80 border border-green-800/50 rounded-lg text-green-400 text-[10px] font-mono tracking-wider"
        >
          -- FPS
        </div>
      )}
    </>
  );
}
