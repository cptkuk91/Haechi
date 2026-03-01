// 디자인 토큰 — 양팀 공유

export const THEME = {
  bg: {
    primary: '#0a0e1a',
    secondary: '#111827',
    panel: 'rgba(15, 23, 42, 0.8)',
    surface: '#0a0f14',
  },
  accent: {
    cyan: '#00f0ff',
    green: '#00ff88',
    amber: '#ffb800',
    red: '#ff3344',
    purple: '#a855f7',
  },
  alert: {
    info: '#3b82f6',
    warning: '#f59e0b',
    critical: '#ef4444',
  },
  text: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    muted: '#475569',
  },
  border: {
    default: '#1e293b',
    glow: 'rgba(0, 240, 255, 0.2)',
  },
} as const;

// 한국 중심 카메라 초기값
export const KOREA_CENTER = {
  latitude: 36.5,
  longitude: 127.5,
  zoom: 7,
  pitch: 45,
  bearing: 0,
} as const;

// Mapbox 다크 스타일
export const MAPBOX_STYLE = 'mapbox://styles/mapbox/dark-v11';
