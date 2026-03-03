'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/app-store';
import {
  useCrimeData,
  useDisasterData,
  useHealthData,
  useInfraData,
  useTrafficData,
  useVulnerableData,
  useWeatherData,
  type PublicAPIResponse,
} from '@/hooks/usePublicAPI';
import { usePolling } from '@/hooks/usePolling';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

export default function Team2LayerBootstrap() {
  const addLayer = useAppStore((s) => s.addLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const selectObject = useAppStore((s) => s.selectObject);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);

  const seenAlertIds = useRef<Set<string>>(new Set());
  const seenWarnings = useRef<Set<string>>(new Set());

  const trafficQuery = useTrafficData();
  const weatherQuery = useWeatherData();
  const disasterQuery = useDisasterData();
  const infraQuery = useInfraData();
  const crimeQuery = useCrimeData();
  const healthQuery = useHealthData();
  const vulnerableQuery = useVulnerableData();

  usePolling(['public-api', 'traffic'], 30_000);
  usePolling(['public-api', 'weather'], 50_000);
  usePolling(['public-api', 'disaster'], 50_000);
  usePolling(['public-api', 'infra'], 60_000);
  usePolling(['public-api', 'crime'], 60_000);
  usePolling(['public-api', 'health'], 60_000);
  usePolling(['public-api', 'vulnerable'], 45_000);

  const syncPayload = useCallback(
    (payload?: PublicAPIResponse) => {
      if (!payload) return;

      const source = payload.source ?? 'mock';
      const affectedDomains = new Set(payload.layers.map((layer) => layer.domain));
      for (const domain of affectedDomains) {
        setDomainDataSource(domain, source);
      }

      const incomingLayerIds = new Set(payload.layers.map((layer) => layer.id));
      const state = useAppStore.getState();
      for (const [layerId, layer] of Object.entries(state.layers)) {
        const isManagedLayer = Boolean(state.layerDataSource[layerId]);
        if (!isManagedLayer) continue;
        if (!affectedDomains.has(layer.domain)) continue;
        if (incomingLayerIds.has(layerId)) continue;
        removeLayer(layerId);
      }

      if (payload.warnings?.length) {
        for (const warning of payload.warnings) {
          const warningKey = `${payload.domain}:${warning}`;
          if (!seenWarnings.current.has(warningKey)) {
            seenWarnings.current.add(warningKey);
            // 개발 단계에서 업스트림 폴백 사유를 노출
            console.warn(`[Team2:${payload.domain}] ${warning}`);
          }
        }
      }

      if (payload.ruleDiagnostics && payload.ruleDiagnostics.generated > 0) {
        const diagKey = `${payload.domain}:rules:${payload.ruleDiagnostics.generated}:${payload.ruleDiagnostics.chained}`;
        if (!seenWarnings.current.has(diagKey)) {
          seenWarnings.current.add(diagKey);
          console.info(
            `[Team2:${payload.domain}] alert-rules generated=${payload.ruleDiagnostics.generated}, chained=${payload.ruleDiagnostics.chained}, total=${payload.ruleDiagnostics.total}`
          );
        }
      }

      for (const layer of payload.layers) {
        const prevLayer = useAppStore.getState().layers[layer.id];
        setLayerDataSource(layer.id, source);

        addLayer({
          ...layer,
          visible: prevLayer?.visible ?? layer.visible,
          onClick: (feature) => {
            selectObject(
              toSelectedObjectFromFeature(feature, {
                id: layer.id,
                domain: layer.domain,
                type: layer.type,
              })
            );
          },
        });
      }

      for (const alert of payload.alerts) {
        const key = `${payload.domain}:${alert.id}`;
        if (seenAlertIds.current.has(key)) continue;
        const accepted = triggerAlert({
          severity: alert.severity,
          domain: alert.domain,
          title: alert.title,
          message: alert.message,
          coordinates: alert.coordinates,
        });
        if (accepted) {
          seenAlertIds.current.add(key);
        }
      }
    },
    [addLayer, removeLayer, selectObject, setDomainDataSource, setLayerDataSource, triggerAlert]
  );

  useEffect(() => {
    syncPayload(trafficQuery.data);
  }, [trafficQuery.data, syncPayload]);

  useEffect(() => {
    syncPayload(weatherQuery.data);
  }, [weatherQuery.data, syncPayload]);

  useEffect(() => {
    syncPayload(disasterQuery.data);
  }, [disasterQuery.data, syncPayload]);

  useEffect(() => {
    syncPayload(infraQuery.data);
  }, [infraQuery.data, syncPayload]);

  useEffect(() => {
    syncPayload(crimeQuery.data);
  }, [crimeQuery.data, syncPayload]);

  useEffect(() => {
    syncPayload(healthQuery.data);
  }, [healthQuery.data, syncPayload]);

  useEffect(() => {
    syncPayload(vulnerableQuery.data);
  }, [vulnerableQuery.data, syncPayload]);

  return null;
}
