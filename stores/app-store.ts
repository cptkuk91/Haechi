import { create } from 'zustand';
import type { LayerConfig, CameraState, SelectedObject, Alert, AlertSeverity, DomainType } from '@/types/domain';
import { KOREA_CENTER } from '@/styles/theme';

interface AppStore {
  // === 1팀 관리 ===
  layers: Record<string, LayerConfig>;
  camera: CameraState;
  selectedObject: SelectedObject | null;

  // === 2팀 관리 ===
  alerts: Alert[];
  rightPanelOpen: boolean;

  // === 1팀 액션 ===
  addLayer: (layer: LayerConfig) => void;
  removeLayer: (id: string) => void;
  updateLayerData: (id: string, data: GeoJSON.FeatureCollection) => void;
  toggleLayer: (id: string) => void;
  setCamera: (camera: Partial<CameraState>) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  selectObject: (obj: SelectedObject | null) => void;

  // === 2팀 액션 ===
  triggerAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'dismissed'>) => void;
  dismissAlert: (id: string) => void;
  setRightPanelOpen: (open: boolean) => void;

  // === 공유 액션 ===
  resetCamera: () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // --- 초기 상태 ---
  layers: {},
  camera: { ...KOREA_CENTER },
  selectedObject: null,
  alerts: [],
  rightPanelOpen: true,

  // --- 1팀 액션 ---
  addLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer.id]: layer } })),

  removeLayer: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.layers;
      return { layers: rest };
    }),

  updateLayerData: (id, data) =>
    set((s) => {
      const layer = s.layers[id];
      if (!layer) return s;
      return { layers: { ...s.layers, [id]: { ...layer, data } } };
    }),

  toggleLayer: (id) =>
    set((s) => {
      const layer = s.layers[id];
      if (!layer) return s;
      return {
        layers: { ...s.layers, [id]: { ...layer, visible: !layer.visible } },
      };
    }),

  setCamera: (camera) =>
    set((s) => ({ camera: { ...s.camera, ...camera } })),

  flyTo: (lat, lng, zoom) =>
    set((s) => ({
      camera: {
        ...s.camera,
        latitude: lat,
        longitude: lng,
        ...(zoom !== undefined ? { zoom } : {}),
      },
    })),

  selectObject: (obj) =>
    set({ selectedObject: obj, rightPanelOpen: obj !== null }),

  // --- 2팀 액션 ---
  triggerAlert: (alertData) =>
    set((s) => ({
      alerts: [
        {
          ...alertData,
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
          dismissed: false,
        },
        ...s.alerts,
      ].slice(0, 50), // 최대 50개 유지
    })),

  dismissAlert: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
    })),

  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  // --- 공유 ---
  resetCamera: () => set({ camera: { ...KOREA_CENTER } }),
}));
