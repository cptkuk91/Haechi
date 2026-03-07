'use client';

import { useDomainLayers } from '@/hooks/useDomainLayers';
import { useAircraftLayer } from '@/hooks/useAircraftLayer';
import { useShipLayer } from '@/hooks/useShipLayer';
import { useCyberDefenseLayer } from '@/hooks/useCyberDefenseLayer';
import { useTransitCitydataLayers } from '@/hooks/useTransitCitydataLayers';
import { useTrafficFlowLayer } from '@/hooks/useTrafficFlowLayer';
import { useWeatherLayer } from '@/hooks/useWeatherLayer';
import { useDisasterLayer } from '@/hooks/useDisasterLayer';
import { useVulnerableLayer } from '@/hooks/useVulnerableLayer';
import { useDispatchLayer } from '@/hooks/useDispatchLayer';
import { useSelectedObjectBinding } from '@/hooks/useSelectedObjectBinding';
import { useNoFlyZonesLayer } from '@/hooks/useNoFlyZonesLayer';
import { useCctvLayer } from '@/hooks/useCctvLayer';
import { useMissingPersonsLayer } from '@/hooks/useMissingPersonsLayer';
import { useWildfireLayer } from '@/hooks/useWildfireLayer';
import { useElderlyWelfareFacilitiesLayer } from '@/hooks/useElderlyWelfareFacilitiesLayer';
import { useChildWelfareFacilitiesLayer } from '@/hooks/useChildWelfareFacilitiesLayer';
import { useDisabledFacilitiesLayer } from '@/hooks/useDisabledFacilitiesLayer';
import { useMulticulturalSupportCentersLayer } from '@/hooks/useMulticulturalSupportCentersLayer';
import { usePublicFacilitySafetyLayer } from '@/hooks/usePublicFacilitySafetyLayer';
import { useHighwayTollgatesLayer } from '@/hooks/useHighwayTollgatesLayer';

export default function LayerBootstrap() {
  useDomainLayers();
  useAircraftLayer();
  useShipLayer();
  useCyberDefenseLayer();
  useTransitCitydataLayers();
  useTrafficFlowLayer();
  useWeatherLayer();
  useDisasterLayer();
  useVulnerableLayer();
  useDispatchLayer();
  useSelectedObjectBinding();
  useNoFlyZonesLayer();
  useCctvLayer();
  useWildfireLayer();
  useMissingPersonsLayer();
  useElderlyWelfareFacilitiesLayer();
  useChildWelfareFacilitiesLayer();
  useDisabledFacilitiesLayer();
  useMulticulturalSupportCentersLayer();
  usePublicFacilitySafetyLayer();
  useHighwayTollgatesLayer();

  return null;
}
