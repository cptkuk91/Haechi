'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AlertSeverity, DomainType, LayerType } from '@/types/domain';

export type PublicDomainRoute =
  | 'traffic'
  | 'weather'
  | 'disaster'
  | 'infra'
  | 'crime'
  | 'health'
  | 'vulnerable';

export interface PublicLayerPayload {
  id: string;
  domain: DomainType;
  name: string;
  type: LayerType;
  visible: boolean;
  style: {
    color?: string | [number, number, number, number?];
    radius?: number;
    lineWidth?: number;
    opacity?: number;
    elevation?: number;
  };
  data: GeoJSON.FeatureCollection;
}

export interface PublicAlertPayload {
  id: string;
  severity: AlertSeverity;
  domain: DomainType;
  title: string;
  message: string;
  coordinates?: [number, number];
}

export interface PublicAPIResponse {
  domain: PublicDomainRoute;
  updatedAt: string;
  layers: PublicLayerPayload[];
  alerts: PublicAlertPayload[];
  metrics: Array<{ label: string; value: string; severity?: AlertSeverity }>;
  source?: 'mock' | 'upstream';
  warnings?: string[];
  ruleDiagnostics?: {
    generated: number;
    chained: number;
    total: number;
  };
}

interface UsePublicAPIOptions {
  enabled?: boolean;
  staleTime?: number;
}

// 도메인별 차등 staleTime (phase.md 스펙)
const DOMAIN_STALE_TIME: Record<PublicDomainRoute, number> = {
  traffic: 30_000,     // 교통: 30초
  weather: 300_000,    // 기상: 5분
  disaster: 60_000,    // 재난: 1분
  infra: 60_000,       // 인프라: 1분
  crime: 60_000,       // 치안: 1분
  health: 300_000,     // 보건: 5분
  vulnerable: 45_000,  // 사회적 약자: 45초
};

// Exponential backoff retry (최대 3회, 1→2→4초)
function retryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}

async function fetchPublicData(domain: PublicDomainRoute): Promise<PublicAPIResponse> {
  const res = await fetch(`/api/${domain}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ${domain} feed: ${res.status}`);
  }
  return (await res.json()) as PublicAPIResponse;
}

export function usePublicAPI(
  domain: PublicDomainRoute,
  options: UsePublicAPIOptions = {}
): UseQueryResult<PublicAPIResponse, Error> {
  return useQuery({
    queryKey: ['public-api', domain],
    queryFn: () => fetchPublicData(domain),
    staleTime: options.staleTime ?? DOMAIN_STALE_TIME[domain],
    enabled: options.enabled ?? true,
    // 장애 시 마지막 성공 데이터 유지
    placeholderData: (previousData) => previousData,
    // Exponential backoff retry (최대 3회)
    retry: 3,
    retryDelay,
    // GC 시간 연장: 장애 시에도 캐시 데이터 더 오래 보존
    gcTime: 600_000, // 10분
    // 포커스 복귀 시 자동 refetch 비활성 (폴링으로 관리)
    refetchOnWindowFocus: false,
  });
}

// 도메인별 편의 훅 — 각각 도메인 특화 staleTime 적용
export const useTrafficData = () => usePublicAPI('traffic');
export const useWeatherData = () => usePublicAPI('weather');
export const useDisasterData = () => usePublicAPI('disaster');
export const useInfraData = () => usePublicAPI('infra');
export const useCrimeData = () => usePublicAPI('crime');
export const useHealthData = () => usePublicAPI('health');
export const useVulnerableData = () => usePublicAPI('vulnerable');
