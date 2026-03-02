import type { AlertSeverity, DomainType, LayerType } from '@/types/domain';
import { fetchDomainUpstream } from '@/app/api/_shared/upstream-source';
import {
  formatTrafficResultWarning,
  getTrafficResultStatus,
  normalizeUpstreamPayload,
} from '@/app/api/_shared/upstream-normalizer';
import { applyAlertRules, type AlertRuleDiagnostics } from '@/app/api/_shared/alert-rule-engine';

export type Team2DomainRoute =
  | 'traffic'
  | 'weather'
  | 'disaster'
  | 'infra'
  | 'crime'
  | 'health'
  | 'vulnerable';

export interface LayerPayload {
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

export interface AlertPayload {
  id: string;
  severity: AlertSeverity;
  domain: DomainType;
  title: string;
  message: string;
  coordinates?: [number, number];
}

export interface DomainPayload {
  domain: Team2DomainRoute;
  updatedAt: string;
  layers: LayerPayload[];
  alerts: AlertPayload[];
  metrics: Array<{ label: string; value: string; severity?: AlertSeverity }>;
}

export type DomainPayloadSource = 'mock' | 'upstream';

export interface DomainPayloadResolution {
  payload: DomainPayload;
  source: DomainPayloadSource;
  warnings: string[];
  ruleDiagnostics: AlertRuleDiagnostics;
}

const TEAM2_ROUTES: Team2DomainRoute[] = [
  'traffic',
  'weather',
  'disaster',
  'infra',
  'crime',
  'health',
  'vulnerable',
];

export function isTeam2DomainRoute(domain: string): domain is Team2DomainRoute {
  return TEAM2_ROUTES.includes(domain as Team2DomainRoute);
}

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features,
  };
}

function point(
  id: string,
  coordinates: [number, number],
  properties: Record<string, unknown>
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates,
    },
    properties: {
      id,
      ...properties,
    },
  };
}

function line(
  id: string,
  coordinates: [number, number][],
  properties: Record<string, unknown>
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates,
    },
    properties: {
      id,
      ...properties,
    },
  };
}

function polygon(
  id: string,
  coordinates: [number, number][],
  properties: Record<string, unknown>
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[...coordinates, coordinates[0]]],
    },
    properties: {
      id,
      ...properties,
    },
  };
}

export function buildDomainPayload(domain: Team2DomainRoute): DomainPayload {
  const updatedAt = new Date().toISOString();

  switch (domain) {
    case 'traffic':
      return {
        domain,
        updatedAt,
        layers: [
          {
            id: 'highway-vms',
            domain: 'highway',
            name: 'VMS 전광표지',
            type: 'marker',
            visible: true,
            style: { color: '#ffb800', radius: 650 },
            data: featureCollection([
              point('vms-seoul', [127.025, 37.491], { name: '경부고속도로 서초', message: '우회도로 이용', status: 'active' }),
              point('vms-daejeon', [127.384, 36.352], { name: '호남고속도로 대전', message: '안개 주의', status: 'active' }),
              point('vms-daegu', [128.603, 35.878], { name: '중앙고속도로 대구', message: '차로 통제', status: 'warning' }),
            ]),
          },
          {
            id: 'highway-incidents',
            domain: 'highway',
            name: '돌발상황',
            type: 'marker',
            visible: true,
            style: { color: '#ff3344', radius: 780 },
            data: featureCollection([
              point('incident-ulsan', [129.307, 35.537], {
                title: '다중 추돌 위험',
                severity: 'critical',
                speedKph: 18,
              }),
              point('incident-busan', [129.042, 35.162], {
                title: '정체 구간',
                severity: 'warning',
                speedKph: 27,
              }),
            ]),
          },
          {
            id: 'highway-bottleneck',
            domain: 'highway',
            name: '병목 구간',
            type: 'line',
            visible: true,
            style: { color: '#ff7a00', lineWidth: 4 },
            data: featureCollection([
              line(
                'bottleneck-1',
                [
                  [126.88, 37.47],
                  [126.95, 37.45],
                  [127.02, 37.43],
                  [127.11, 37.4],
                ],
                { congestion: 0.84 }
              ),
            ]),
          },
          {
            id: 'highway-reroute',
            domain: 'highway',
            name: '우회 권고 경로',
            type: 'line',
            visible: false,
            style: { color: '#00ff88', lineWidth: 5 },
            data: featureCollection([
              line(
                'reroute-1',
                [
                  [126.91, 37.48],
                  [126.97, 37.52],
                  [127.06, 37.5],
                  [127.14, 37.46],
                ],
                { reason: 'incident-ulsan', etaDiffMin: -14 }
              ),
            ]),
          },
        ],
        alerts: [
          {
            id: 'traffic-critical-ulsan',
            domain: 'highway',
            severity: 'critical',
            title: '고속도로 충돌 위험',
            message: '울산 구간 평균 속도 20km/h 이하. 우회 경로 시뮬레이션 필요.',
            coordinates: [129.307, 35.537],
          },
        ],
        metrics: [
          { label: '활성 VMS', value: '124' },
          { label: '돌발상황', value: '18', severity: 'warning' },
          { label: '임계 혼잡도', value: '84%', severity: 'critical' },
        ],
      };

    case 'weather':
      return {
        domain,
        updatedAt,
        layers: [
          {
            id: 'weather-rainfall-heat',
            domain: 'weather',
            name: '강우 집중도',
            type: 'heatmap',
            visible: true,
            style: { radius: 42 },
            data: featureCollection([
              point('rain-1', [126.981, 37.552], { weight: 0.91, rainMm: 55 }),
              point('rain-2', [127.712, 37.888], { weight: 0.82, rainMm: 49 }),
              point('rain-3', [128.901, 35.214], { weight: 0.7, rainMm: 38 }),
              point('rain-4', [126.544, 33.385], { weight: 0.95, rainMm: 62 }),
            ]),
          },
          {
            id: 'weather-storm-zone',
            domain: 'weather',
            name: '국지성 폭우 경보권',
            type: 'polygon',
            visible: true,
            style: { color: '#3b82f6', opacity: 0.26, elevation: 1500 },
            data: featureCollection([
              polygon(
                'storm-seoul-east',
                [
                  [127.02, 37.66],
                  [127.36, 37.61],
                  [127.28, 37.39],
                  [126.98, 37.42],
                ],
                { level: 'warning', eta: '45m' }
              ),
            ]),
          },
          {
            id: 'weather-rainfall-column',
            domain: 'weather',
            name: '시간당 강수 3D 컬럼',
            type: 'column',
            visible: true,
            style: { color: '#3b82f6', radius: 950, elevation: 800 },
            data: featureCollection([
              point('rain-col-seoul', [127.046, 37.524], { rainMm: 62, threshold: 50 }),
              point('rain-col-jeju', [126.553, 33.417], { rainMm: 71, threshold: 50 }),
              point('rain-col-gangwon', [128.671, 37.821], { rainMm: 48, threshold: 50 }),
            ]),
          },
          {
            id: 'weather-wind-particles',
            domain: 'weather',
            name: '풍향/풍속 파티클',
            type: 'particle',
            visible: false,
            style: { color: '#00f0ff', radius: 300, opacity: 0.72 },
            data: featureCollection([
              point('wind-west', [126.73, 37.44], { windKph: 19, direction: 78 }),
              point('wind-center', [127.54, 36.78], { windKph: 24, direction: 95 }),
              point('wind-east', [128.94, 36.42], { windKph: 28, direction: 112 }),
              point('wind-south', [129.21, 35.12], { windKph: 22, direction: 135 }),
            ]),
          },
        ],
        alerts: [
          {
            id: 'weather-warning-east',
            domain: 'weather',
            severity: 'warning',
            title: '집중호우 접근',
            message: '동부권 시간당 강수량 50mm 예상. 배수 경보 준비.',
            coordinates: [127.21, 37.52],
          },
          {
            id: 'weather-critical-rain',
            domain: 'weather',
            severity: 'critical',
            title: '집중호우 임계치 초과',
            message: '제주권 시간당 강수량 70mm 초과. 침수 대응 경보 발령.',
            coordinates: [126.553, 33.417],
          },
        ],
        metrics: [
          { label: '강수 스테이션', value: '387' },
          { label: '폭우 경보권', value: '2', severity: 'warning' },
          { label: '평균 풍속', value: '7.2m/s' },
          { label: '강수 임계 초과', value: '2', severity: 'critical' },
        ],
      };

    case 'disaster':
      return {
        domain,
        updatedAt,
        layers: [
          {
            id: 'disaster-wildfire-points',
            domain: 'disaster',
            name: '산불 확산 지점',
            type: 'marker',
            visible: true,
            style: { color: '#ef4444', radius: 820 },
            data: featureCollection([
              point('fire-gangwon', [128.612, 37.751], { tempC: 412, spread: 'rapid' }),
              point('fire-andong', [128.729, 36.568], { tempC: 367, spread: 'moderate' }),
            ]),
          },
          {
            id: 'disaster-flood-risk',
            domain: 'disaster',
            name: '하천 범람 위험권',
            type: 'polygon',
            visible: false,
            style: { color: '#0ea5e9', opacity: 0.2, elevation: 900 },
            data: featureCollection([
              polygon(
                'flood-nakdong',
                [
                  [128.91, 35.31],
                  [129.15, 35.26],
                  [129.14, 35.11],
                  [128.88, 35.13],
                ],
                { level: 'watch', river: '낙동강' }
              ),
            ]),
          },
          {
            id: 'disaster-earthquake-ripple',
            domain: 'disaster',
            name: '지진 진앙지 리플',
            type: 'column',
            visible: false,
            style: { color: '#f59e0b', radius: 1200, elevation: 900 },
            data: featureCollection([
              point('quake-east-sea', [129.35, 37.52], { magnitude: 3.9, depthKm: 12 }),
              point('quake-jeju-sea', [126.31, 33.86], { magnitude: 3.2, depthKm: 17 }),
            ]),
          },
        ],
        alerts: [
          {
            id: 'disaster-fire-gangwon',
            domain: 'disaster',
            severity: 'critical',
            title: '산불 확산 경보',
            message: '강원권 산불 확산속도 증가. 인근 레이어 연쇄 경보 필요.',
            coordinates: [128.612, 37.751],
          },
          {
            id: 'disaster-earthquake-watch',
            domain: 'disaster',
            severity: 'warning',
            title: '동해 지진 감지',
            message: '동해권 규모 3.9 지진 감지. 인근 대피소 경로 확인 필요.',
            coordinates: [129.35, 37.52],
          },
        ],
        metrics: [
          { label: '활성 화점', value: '11', severity: 'critical' },
          { label: '대피 권고', value: '4개 면' },
          { label: '범람 감시', value: '7 구간', severity: 'warning' },
          { label: '지진 감지', value: '2건', severity: 'warning' },
        ],
      };

    case 'infra':
      return {
        domain,
        updatedAt,
        layers: [
          {
            id: 'infra-grid-nodes',
            domain: 'infra',
            name: '전력망 노드',
            type: 'marker',
            visible: true,
            style: { color: '#f97316', radius: 700 },
            data: featureCollection([
              point('grid-seoul', [127.087, 37.506], { loadPct: 74, type: 'substation' }),
              point('grid-ulsan', [129.228, 35.512], { loadPct: 89, type: 'plant' }),
              point('grid-gwangju', [126.888, 35.169], { loadPct: 66, type: 'substation' }),
            ]),
          },
          {
            id: 'infra-radiation-zone',
            domain: 'infra',
            name: '원전 감시권',
            type: 'polygon',
            visible: false,
            style: { color: '#f97316', opacity: 0.18, elevation: 600 },
            data: featureCollection([
              polygon(
                'npp-gyeongju',
                [
                  [129.33, 35.82],
                  [129.49, 35.84],
                  [129.47, 35.71],
                  [129.31, 35.69],
                ],
                { rad: 0.12, unit: 'uSv/h' }
              ),
            ]),
          },
        ],
        alerts: [
          {
            id: 'infra-load-warning',
            domain: 'infra',
            severity: 'warning',
            title: '전력 부하 상승',
            message: '울산 변전소 부하율 89% 도달. 수요 분산 권고.',
            coordinates: [129.228, 35.512],
          },
        ],
        metrics: [
          { label: '부하율 상위 노드', value: '3', severity: 'warning' },
          { label: '원전 감시소', value: '24' },
          { label: '수자원 센서', value: '141' },
        ],
      };

    case 'crime':
      return {
        domain,
        updatedAt,
        layers: [
          {
            id: 'crime-risk-heatmap',
            domain: 'crime',
            name: '범죄 위험 히트맵',
            type: 'heatmap',
            visible: true,
            style: { radius: 36 },
            data: featureCollection([
              point('crime-seoul-hongdae', [126.924, 37.557], { weight: 0.85, period: 'night' }),
              point('crime-seoul-gangnam', [127.028, 37.497], { weight: 0.91, period: 'night' }),
              point('crime-busan-seomyeon', [129.06, 35.155], { weight: 0.74, period: 'evening' }),
            ]),
          },
          {
            id: 'crime-patrol-route',
            domain: 'crime',
            name: '순찰 집중선',
            type: 'line',
            visible: false,
            style: { color: '#f59e0b', lineWidth: 3 },
            data: featureCollection([
              line(
                'patrol-gangnam',
                [
                  [127.02, 37.505],
                  [127.028, 37.498],
                  [127.035, 37.49],
                ],
                { shift: 'night' }
              ),
            ]),
          },
        ],
        alerts: [],
        metrics: [
          { label: '고위험 클러스터', value: '6', severity: 'warning' },
          { label: '순찰 노드', value: '42' },
          { label: '평균 대응시간', value: '4m 20s' },
        ],
      };

    case 'health':
      return {
        domain,
        updatedAt,
        layers: [
          {
            id: 'health-ambulance-track',
            domain: 'health',
            name: '구급차 위치',
            type: 'marker',
            visible: true,
            style: { color: '#10b981', radius: 760 },
            data: featureCollection([
              point('ambulance-1', [127.004, 37.566], { status: 'dispatch', etaMin: 5 }),
              point('ambulance-2', [129.074, 35.179], { status: 'transfer', etaMin: 7 }),
            ]),
          },
          {
            id: 'health-er-capacity',
            domain: 'health',
            name: '응급실 수용 현황',
            type: 'marker',
            visible: true,
            style: { color: '#22c55e', radius: 620 },
            data: featureCollection([
              point('er-seoul', [126.995, 37.579], { occupancyPct: 74, availableBeds: 11 }),
              point('er-daejeon', [127.41, 36.351], { occupancyPct: 89, availableBeds: 3 }),
                point('er-busan', [129.09, 35.195], { occupancyPct: 68, availableBeds: 9 }),
              ]),
            },
          {
            id: 'health-ambulance-route',
            domain: 'health',
            name: '구급차 출동 궤적',
            type: 'line',
            visible: false,
            style: { color: '#10b981', lineWidth: 4 },
            data: featureCollection([
              line(
                'ambulance-route-1',
                [
                  [126.995, 37.58],
                  [127.004, 37.566],
                  [127.014, 37.553],
                ],
                { ambulanceId: 'ambulance-1', etaMin: 5 }
              ),
              line(
                'ambulance-route-2',
                [
                  [129.09, 35.195],
                  [129.074, 35.179],
                  [129.055, 35.166],
                ],
                { ambulanceId: 'ambulance-2', etaMin: 7 }
              ),
            ]),
          },
          {
            id: 'health-infection-zone',
            domain: 'health',
            name: '감염병 확산 시뮬레이션',
            type: 'polygon',
            visible: false,
            style: { color: '#ef4444', opacity: 0.16, elevation: 700 },
            data: featureCollection([
              polygon(
                'infection-zone-seoul',
                [
                  [126.95, 37.61],
                  [127.11, 37.61],
                  [127.14, 37.51],
                  [126.99, 37.49],
                ],
                { stage: 'watch', radiusKm: 6 }
              ),
            ]),
          },
        ],
        alerts: [
          {
            id: 'health-er-warning',
            domain: 'health',
            severity: 'warning',
            title: '응급실 포화 임박',
            message: '대전 권역 응급실 가동률 89%. 인접 권역 분산 필요.',
            coordinates: [127.41, 36.351],
          },
        ],
        metrics: [
          { label: '가동 중 구급차', value: '57' },
          { label: '응급실 평균 가동률', value: '77%', severity: 'warning' },
          { label: '중환자실 여유', value: '34 beds' },
        ],
      };

    case 'vulnerable':
      return {
        domain,
        updatedAt,
        layers: [
          {
            id: 'vulnerable-amber-radius',
            domain: 'vulnerable',
            name: 'Amber Alert 이동 반경',
            type: 'column',
            visible: true,
            style: { color: '#ec4899', radius: 1400, elevation: 650 },
            data: featureCollection([
              point('amber-seoul', [127.013, 37.565], { radiusKm: 2.5, elapsedMin: 12 }),
              point('amber-busan', [129.054, 35.171], { radiusKm: 1.8, elapsedMin: 7 }),
            ]),
          },
          {
            id: 'vulnerable-emergency-iot',
            domain: 'vulnerable',
            name: '독거노인 IoT 응급',
            type: 'marker',
            visible: true,
            style: { color: '#f43f5e', radius: 820 },
            data: featureCollection([
              point('iot-seoul-01', [127.022, 37.576], { status: 'no-signal', lastHeartbeatMin: 41 }),
              point('iot-gwangju-01', [126.867, 35.156], { status: 'warning', lastHeartbeatMin: 28 }),
            ]),
          },
          {
            id: 'vulnerable-support-link',
            domain: 'vulnerable',
            name: '인근 지원기관 연결',
            type: 'line',
            visible: false,
            style: { color: '#f472b6', lineWidth: 3 },
            data: featureCollection([
              line(
                'support-seoul',
                [
                  [127.022, 37.576],
                  [127.006, 37.57],
                  [126.995, 37.579],
                ],
                { from: 'iot-seoul-01', to: 'er-seoul' }
              ),
            ]),
          },
        ],
        alerts: [
          {
            id: 'vulnerable-amber-critical',
            domain: 'vulnerable',
            severity: 'critical',
            title: 'Amber Alert 발령',
            message: '서울 도심권 실종 경보 발령. CCTV 레이어 연동 추적 필요.',
            coordinates: [127.013, 37.565],
          },
          {
            id: 'vulnerable-iot-warning',
            domain: 'vulnerable',
            severity: 'warning',
            title: 'IoT 무응답 감지',
            message: '독거노인 센서 무응답 40분 경과. 인근 의료기관 연계 권장.',
            coordinates: [127.022, 37.576],
          },
        ],
        metrics: [
          { label: 'Amber Alert', value: '2', severity: 'critical' },
          { label: 'IoT 무응답', value: '5', severity: 'warning' },
          { label: '연계 기관', value: '19' },
        ],
      };
  }
}

export async function resolveDomainPayload(
  domain: Team2DomainRoute
): Promise<DomainPayloadResolution> {
  const fallback = buildDomainPayload(domain);
  const upstream = await fetchDomainUpstream(domain);

  if (!upstream.raw) {
    const ruled = applyAlertRules(fallback);
    return {
      payload: ruled.payload,
      source: 'mock',
      warnings: upstream.warnings,
      ruleDiagnostics: ruled.diagnostics,
    };
  }

  const normalized = normalizeUpstreamPayload(domain, upstream.raw);
  if (!normalized) {
    const trafficStatus = domain === 'traffic' ? getTrafficResultStatus(upstream.raw) : null;
    const trafficWarning = trafficStatus ? formatTrafficResultWarning(trafficStatus) : null;

    const warnings = [...upstream.warnings];
    if (trafficWarning) warnings.push(trafficWarning);
    if (!trafficWarning) warnings.push(`Invalid upstream payload shape for ${domain}`);

    const ruled = applyAlertRules(fallback);
    return {
      payload: ruled.payload,
      source: 'mock',
      warnings,
      ruleDiagnostics: ruled.diagnostics,
    };
  }

  const ruled = applyAlertRules(normalized);
  return {
    payload: ruled.payload,
    source: 'upstream',
    warnings: upstream.warnings,
    ruleDiagnostics: ruled.diagnostics,
  };
}
