import { create } from 'zustand';
import type { LayerConfig, CameraState, SelectedObject, Alert, AlertSeverity, DomainType } from '@/types/domain';
import { DOMAIN_REGISTRY } from '@/types/domain';
import { KOREA_CENTER } from '@/styles/theme';

interface AlertPreferences {
  severities: Record<AlertSeverity, boolean>;
  domains: Record<DomainType, boolean>;
}

interface AppStore {
  // === 1팀 관리 ===
  layers: Record<string, LayerConfig>;
  camera: CameraState;
  selectedObject: SelectedObject | null;

  // === 2팀 관리 ===
  alerts: Alert[];
  toastAlertIds: string[];
  alertPreferences: AlertPreferences;
  rightPanelOpen: boolean;
  domainDataSource: Partial<Record<DomainType, 'mock' | 'upstream'>>;
  layerDataSource: Record<string, 'mock' | 'upstream'>;

  // === 1팀 액션 ===
  addLayer: (layer: LayerConfig) => void;
  removeLayer: (id: string) => void;
  updateLayerData: (id: string, data: GeoJSON.FeatureCollection) => void;
  toggleLayer: (id: string) => void;
  setCamera: (camera: Partial<CameraState>) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  selectObject: (obj: SelectedObject | null) => void;

  // === 2팀 액션 ===
  triggerAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'dismissed'>) => boolean;
  openAlertToast: (id: string) => void;
  closeAlertToast: (id: string) => void;
  clearAlertToasts: () => void;
  dismissAlert: (id: string) => void;
  dismissAllAlerts: () => void;
  clearDismissedAlerts: () => void;
  clearAllAlerts: () => void;
  setAlertSeverityEnabled: (severity: AlertSeverity, enabled: boolean) => void;
  setAlertDomainEnabled: (domain: DomainType, enabled: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setDomainDataSource: (domain: DomainType, source: 'mock' | 'upstream') => void;
  setLayerDataSource: (layerId: string, source: 'mock' | 'upstream') => void;

  // === 공유 액션 ===
  resetCamera: () => void;
}

const DEFAULT_ALERT_SEVERITIES: Record<AlertSeverity, boolean> = {
  info: false,
  warning: false,
  critical: false,
};

const DEFAULT_ALERT_DOMAINS = DOMAIN_REGISTRY.reduce<Record<DomainType, boolean>>((acc, domain) => {
  acc[domain.id] = false;
  return acc;
}, {} as Record<DomainType, boolean>);

export const useAppStore = create<AppStore>((set) => ({
  // --- 초기 상태 ---
  layers: {},
  camera: { ...KOREA_CENTER },
  selectedObject: null,
  alerts: [],
  toastAlertIds: [],
  alertPreferences: {
    severities: { ...DEFAULT_ALERT_SEVERITIES },
    domains: { ...DEFAULT_ALERT_DOMAINS },
  },
  rightPanelOpen: true,
  domainDataSource: {},
  layerDataSource: {},

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
  triggerAlert: (alertData) => {
    let accepted = false;

    set((s) => {
      const allowSeverity = s.alertPreferences.severities[alertData.severity];
      const allowDomain = s.alertPreferences.domains[alertData.domain];
      if (!allowSeverity || !allowDomain) return s;

      accepted = true;
      return {
        alerts: [
          {
            ...alertData,
            id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            dismissed: false,
          },
          ...s.alerts,
        ].slice(0, 50), // 최대 50개 유지
      };
    });

    return accepted;
  },

  openAlertToast: (id) =>
    set((s) => {
      const exists = s.alerts.some((alert) => alert.id === id && !alert.dismissed);
      if (!exists) return s;

      const nextToastAlertIds = [id, ...s.toastAlertIds.filter((alertId) => alertId !== id)].slice(0, 4);
      const unchanged =
        nextToastAlertIds.length === s.toastAlertIds.length &&
        nextToastAlertIds.every((alertId, index) => alertId === s.toastAlertIds[index]);

      return unchanged ? s : { toastAlertIds: nextToastAlertIds };
    }),

  closeAlertToast: (id) =>
    set((s) => {
      const nextToastAlertIds = s.toastAlertIds.filter((alertId) => alertId !== id);
      return nextToastAlertIds.length === s.toastAlertIds.length ? s : { toastAlertIds: nextToastAlertIds };
    }),

  clearAlertToasts: () =>
    set((s) => (s.toastAlertIds.length > 0 ? { toastAlertIds: [] } : s)),

  dismissAlert: (id) =>
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, dismissed: true } : a)),
      toastAlertIds: s.toastAlertIds.filter((alertId) => alertId !== id),
    })),

  dismissAllAlerts: () =>
    set((s) => {
      let changed = false;
      const nextAlerts = s.alerts.map((a) => {
        if (a.dismissed) return a;
        changed = true;
        return { ...a, dismissed: true };
      });
      if (!changed && s.toastAlertIds.length === 0) return s;
      return { alerts: nextAlerts, toastAlertIds: [] };
    }),

  clearDismissedAlerts: () =>
    set((s) => {
      const nextAlerts = s.alerts.filter((a) => !a.dismissed);
      const liveIdSet = new Set(nextAlerts.map((a) => a.id));
      const nextToastAlertIds = s.toastAlertIds.filter((id) => liveIdSet.has(id));
      const alertsUnchanged = nextAlerts.length === s.alerts.length;
      const toastsUnchanged =
        nextToastAlertIds.length === s.toastAlertIds.length &&
        nextToastAlertIds.every((id, index) => id === s.toastAlertIds[index]);
      if (alertsUnchanged && toastsUnchanged) return s;
      return { alerts: nextAlerts, toastAlertIds: nextToastAlertIds };
    }),

  clearAllAlerts: () =>
    set((s) => (s.alerts.length > 0 || s.toastAlertIds.length > 0 ? { alerts: [], toastAlertIds: [] } : s)),

  setAlertSeverityEnabled: (severity, enabled) =>
    set((s) => ({
      alertPreferences: {
        ...s.alertPreferences,
        severities: {
          ...s.alertPreferences.severities,
          [severity]: enabled,
        },
      },
    })),

  setAlertDomainEnabled: (domain, enabled) =>
    set((s) => ({
      alertPreferences: {
        ...s.alertPreferences,
        domains: {
          ...s.alertPreferences.domains,
          [domain]: enabled,
        },
      },
    })),

  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  setDomainDataSource: (domain, source) =>
    set((s) => {
      if (s.domainDataSource[domain] === source) return s;
      return {
        domainDataSource: {
          ...s.domainDataSource,
          [domain]: source,
        },
      };
    }),

  setLayerDataSource: (layerId, source) =>
    set((s) => {
      if (s.layerDataSource[layerId] === source) return s;
      return {
        layerDataSource: {
          ...s.layerDataSource,
          [layerId]: source,
        },
      };
    }),

  // --- 공유 ---
  resetCamera: () => set({ camera: { ...KOREA_CENTER } }),
}));
