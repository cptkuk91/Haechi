// 도메인 타입 정의 — 양팀 공유 인터페이스 계약

export type DomainType =
  // 1팀 도메인
  | 'aviation'
  | 'cctv'
  | 'maritime'
  | 'transit'
  | 'defense'
  | 'cyber'
  // 2팀 도메인
  | 'highway'
  | 'disaster'
  | 'weather'
  | 'crime'
  | 'health'
  | 'infra'
  | 'vulnerable';

export type LayerType = 'marker' | 'polygon' | 'line' | 'heatmap' | 'particle' | 'arc' | 'icon' | 'column';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface LayerStyle {
  color?: string | [number, number, number, number?];
  opacity?: number;
  radius?: number;
  lineWidth?: number;
  elevation?: number;
  animated?: boolean;
}

export interface LayerConfig {
  id: string;
  domain: DomainType;
  name: string;
  type: LayerType;
  visible: boolean;
  data: GeoJSON.FeatureCollection | null;
  style: LayerStyle;
  zIndex?: number;
  onClick?: (feature: GeoJSON.Feature) => void;
  onHover?: (feature: GeoJSON.Feature) => void;
}

export interface CameraState {
  latitude: number;
  longitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface SelectedObject {
  id: string;
  domain: DomainType;
  type: string;
  properties: Record<string, unknown>;
  coordinates: [number, number];
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  domain: DomainType;
  title: string;
  message: string;
  coordinates?: [number, number];
  timestamp: number;
  dismissed: boolean;
}

export interface DomainInfo {
  id: DomainType;
  name: string;
  nameKo: string;
  icon: string;
  color: string;
  layers: string[];
}

export const DOMAIN_REGISTRY: DomainInfo[] = [
  { id: 'aviation', name: 'Aviation & Airspace', nameKo: '항공/공역 관제', icon: '✈️', color: '#00f0ff', layers: [] },
  { id: 'cctv', name: 'CCTV Surveillance', nameKo: '영상 보안 관제', icon: '📷', color: '#00ff88', layers: [] },
  { id: 'highway', name: 'Highway Traffic', nameKo: '도로 교통 관제', icon: '🚗', color: '#ffb800', layers: [] },
  { id: 'defense', name: 'Territorial Security', nameKo: '국방/영토 안보', icon: '🛡️', color: '#ff3344', layers: [] },
  { id: 'disaster', name: 'Disasters & Environment', nameKo: '재난/재해', icon: '🚨', color: '#ef4444', layers: [] },
  { id: 'weather', name: 'Weather & Atmosphere', nameKo: '기상/대기 환경', icon: '🌤️', color: '#3b82f6', layers: [] },
  { id: 'maritime', name: 'Maritime & Port', nameKo: '해양/항만 관제', icon: '⚓', color: '#06b6d4', layers: [] },
  { id: 'crime', name: 'Crime & Public Safety', nameKo: '치안/범죄 예방', icon: '🚔', color: '#f59e0b', layers: [] },
  { id: 'transit', name: 'Transit & Crowd', nameKo: '대중교통/군중', icon: '🚋', color: '#8b5cf6', layers: [] },
  { id: 'health', name: 'Healthcare & Emergency', nameKo: '보건/의료', icon: '🏥', color: '#10b981', layers: [] },
  { id: 'infra', name: 'Critical Infrastructure', nameKo: '국가 인프라', icon: '⚡', color: '#f97316', layers: [] },
  { id: 'cyber', name: 'Cybersecurity', nameKo: '사이버 안보', icon: '💻', color: '#a855f7', layers: [] },
  { id: 'vulnerable', name: 'Vulnerable Populations', nameKo: '사회적 약자', icon: '🧑‍🦯', color: '#ec4899', layers: [] },
];
