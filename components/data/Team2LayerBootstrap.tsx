'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { DomainType } from '@/types/domain';
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
import { useHealthEmergencyRoomsLayer } from '@/hooks/useHealthEmergencyRoomsLayer';
import { useHealthTraumaCentersLayer } from '@/hooks/useHealthTraumaCentersLayer';
import { usePolling } from '@/hooks/usePolling';
import { toSelectedObjectFromFeature } from '@/lib/selected-object';

const EXTERNALLY_MANAGED_LAYER_IDS = new Set<string>([
  'disaster-wildfire-points',
  'vulnerable-missing-persons',
  'vulnerable-elderly-welfare-facilities',
  'vulnerable-child-welfare-facilities',
  'vulnerable-disabled-facilities',
  'vulnerable-multicultural-support-centers',
  'infra-public-facility-safety',
  'infra-highway-tollgates',
  'health-emergency-room-location',
  'health-trauma-centers',
]);

function toDomainType(route: PublicAPIResponse['domain']): DomainType {
  return route === 'traffic' ? 'highway' : route;
}

export default function Team2LayerBootstrap() {
  const addLayer = useAppStore((s) => s.addLayer);
  const removeLayer = useAppStore((s) => s.removeLayer);
  const selectObject = useAppStore((s) => s.selectObject);
  const triggerAlert = useAppStore((s) => s.triggerAlert);
  const setDomainDataSource = useAppStore((s) => s.setDomainDataSource);
  const setLayerDataSource = useAppStore((s) => s.setLayerDataSource);
  const setPipelineErrors = useAppStore((s) => s.setPipelineErrors);

  const seenAlertIds = useRef<Set<string>>(new Set());
  const seenWarnings = useRef<Set<string>>(new Set());

  useHealthEmergencyRoomsLayer();
  useHealthTraumaCentersLayer();

  const trafficQuery = useTrafficData();
  const weatherQuery = useWeatherData();
  const disasterQuery = useDisasterData();
  const infraQuery = useInfraData();
  const crimeQuery = useCrimeData();
  const healthQuery = useHealthData();
  const vulnerableQuery = useVulnerableData();

  // Pipeline error 상태를 store에 동기화
  useEffect(() => {
    const errors = new Set<string>();
    if (trafficQuery.isError) errors.add('traffic');
    if (weatherQuery.isError) errors.add('weather');
    if (disasterQuery.isError) errors.add('disaster');
    if (infraQuery.isError) errors.add('infra');
    if (crimeQuery.isError) errors.add('crime');
    if (healthQuery.isError) errors.add('health');
    if (vulnerableQuery.isError) errors.add('vulnerable');
    setPipelineErrors(errors);
  }, [
    trafficQuery.isError, weatherQuery.isError, disasterQuery.isError,
    infraQuery.isError, crimeQuery.isError, healthQuery.isError,
    vulnerableQuery.isError, setPipelineErrors,
  ]);

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
      const stateSnapshot = useAppStore.getState();
      const affectedDomains = new Set<DomainType>([
        toDomainType(payload.domain),
        ...payload.layers.map((layer) => layer.domain),
      ]);
      for (const domain of affectedDomains) {
        const keepUpstreamDomain =
          source === 'mock'
          && Object.values(stateSnapshot.layers).some(
            (layer) =>
              layer.domain === domain
              && EXTERNALLY_MANAGED_LAYER_IDS.has(layer.id)
              && stateSnapshot.layerDataSource[layer.id] === 'upstream'
          );
        if (keepUpstreamDomain) continue;
        setDomainDataSource(domain, source);
      }

      const incomingLayerIds = new Set(payload.layers.map((layer) => layer.id));
      for (const [layerId, layer] of Object.entries(stateSnapshot.layers)) {
        const isManagedLayer = Boolean(stateSnapshot.layerDataSource[layerId]);
        if (!isManagedLayer) continue;
        if (EXTERNALLY_MANAGED_LAYER_IDS.has(layerId)) continue;
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
        const prevLayerSource = useAppStore.getState().layerDataSource[layer.id];
        const preserveExternalUpstream =
          source === 'mock'
          && EXTERNALLY_MANAGED_LAYER_IDS.has(layer.id)
          && prevLayerSource === 'upstream'
          && Boolean(prevLayer);
        if (!preserveExternalUpstream) {
          setLayerDataSource(layer.id, source);
        }

        addLayer({
          ...layer,
          data: preserveExternalUpstream ? prevLayer.data : layer.data,
          visible: prevLayer?.visible ?? false,
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
