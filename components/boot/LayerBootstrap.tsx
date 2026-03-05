'use client';

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
import { useHealthEmergencyRoomsLayer } from '@/hooks/useHealthEmergencyRoomsLayer';
import { useMissingPersonsLayer } from '@/hooks/useMissingPersonsLayer';
import { useWildfireLayer } from '@/hooks/useWildfireLayer';
import { useElderlyWelfareFacilitiesLayer } from '@/hooks/useElderlyWelfareFacilitiesLayer';

export default function LayerBootstrap() {
  useDomainLayers();
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
  useWildfireLayer();
  useHealthEmergencyRoomsLayer();
  useMissingPersonsLayer();
  useElderlyWelfareFacilitiesLayer();

  return null;
}
