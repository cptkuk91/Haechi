import type { AlertSeverity, DomainType } from '@/types/domain';
import type { AlertPayload, DomainPayload } from '@/app/api/_shared/domain-payload';

export interface AlertRuleDiagnostics {
  generated: number;
  chained: number;
  total: number;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getPointCoordinates(feature: GeoJSON.Feature): [number, number] | undefined {
  const g = feature.geometry;
  if (!g) return undefined;

  if (g.type === 'Point') {
    return [g.coordinates[0], g.coordinates[1]];
  }
  if (g.type === 'LineString' && g.coordinates[0]) {
    return [g.coordinates[0][0], g.coordinates[0][1]];
  }
  if (g.type === 'Polygon' && g.coordinates[0]?.[0]) {
    return [g.coordinates[0][0][0], g.coordinates[0][0][1]];
  }
  return undefined;
}

function makeAlertKey(alert: AlertPayload): string {
  const coord = alert.coordinates ? `${alert.coordinates[0].toFixed(3)},${alert.coordinates[1].toFixed(3)}` : 'n/a';
  return `${alert.domain}:${alert.severity}:${alert.title}:${coord}`;
}

function createAlert(args: {
  id: string;
  domain: DomainType;
  severity: AlertSeverity;
  title: string;
  message: string;
  coordinates?: [number, number];
}): AlertPayload {
  return {
    id: args.id,
    domain: args.domain,
    severity: args.severity,
    title: args.title,
    message: args.message,
    coordinates: args.coordinates,
  };
}

function addAlert(
  alerts: AlertPayload[],
  alert: AlertPayload,
  seen: Set<string>,
  diagnostics: { generated: number; chained: number },
  chained = false
): void {
  const key = makeAlertKey(alert);
  if (seen.has(key)) return;
  seen.add(key);
  alerts.push(alert);
  if (chained) diagnostics.chained += 1;
  else diagnostics.generated += 1;
}

function runTrafficRules(
  payload: DomainPayload,
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  const incidentLayer = payload.layers.find((layer) => layer.id === 'highway-incidents');
  if (incidentLayer?.data) {
    for (const feature of incidentLayer.data.features) {
      const properties = (feature.properties as Record<string, unknown> | null) ?? {};
      const severity =
        properties.severity === 'critical' || properties.severity === 'warning' || properties.severity === 'info'
          ? properties.severity
          : 'warning';
      const title = typeof properties.title === 'string' ? properties.title : '도로 돌발 상황';
      const speedKph = toNumber(properties.speedKph);

      addAlert(
        alerts,
        createAlert({
          id: `rule-${payload.domain}-${String(properties.id ?? title).toLowerCase().replace(/\s+/g, '-')}`,
          domain: 'highway',
          severity,
          title,
          message:
            speedKph !== null
              ? `평균 속도 ${speedKph}km/h. 우회 경로 검토 필요.`
              : '돌발 상황이 감지되었습니다. 우회 경로를 검토하세요.',
          coordinates: getPointCoordinates(feature),
        }),
        seen,
        diagnostics
      );
    }
  }

  const bottleneckLayer = payload.layers.find((layer) => layer.id === 'highway-bottleneck');
  if (bottleneckLayer?.data) {
    for (const feature of bottleneckLayer.data.features) {
      const properties = (feature.properties as Record<string, unknown> | null) ?? {};
      const congestion = toNumber(properties.congestion);
      if (congestion !== null && congestion >= 0.8) {
        addAlert(
          alerts,
          createAlert({
            id: `rule-${payload.domain}-bottleneck-${Math.round(congestion * 100)}`,
            domain: 'highway',
            severity: congestion >= 0.9 ? 'critical' : 'warning',
            title: '고속도로 병목 임계치 도달',
            message: `혼잡도 ${Math.round(congestion * 100)}% 구간 감지. 정체 구간 회피를 권고합니다.`,
            coordinates: getPointCoordinates(feature),
          }),
          seen,
          diagnostics
        );
      }
    }
  }
}

function runWeatherRules(
  payload: DomainPayload,
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  const rainfallLayer = payload.layers.find((layer) => layer.id === 'weather-rainfall-column');
  if (!rainfallLayer?.data) return;

  for (const feature of rainfallLayer.data.features) {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const rainMm = toNumber(props.rainMm);
    if (rainMm === null) continue;

    const severity: AlertSeverity = rainMm >= 70 ? 'critical' : rainMm >= 50 ? 'warning' : 'info';
    if (severity === 'info') continue;

    addAlert(
      alerts,
      createAlert({
        id: `rule-weather-rain-${Math.round(rainMm)}-${String(props.id ?? 'zone')}`,
        domain: 'weather',
        severity,
        title: '강수 임계치 경보',
        message: `시간당 강수량 ${rainMm}mm 감지. 배수 및 침수 대응을 준비하세요.`,
        coordinates: getPointCoordinates(feature),
      }),
      seen,
      diagnostics
    );
  }
}

function runDisasterRules(
  payload: DomainPayload,
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  const wildfireLayer = payload.layers.find((layer) => layer.id === 'disaster-wildfire-points');
  if (wildfireLayer?.data) {
    for (const feature of wildfireLayer.data.features) {
      const props = (feature.properties as Record<string, unknown> | null) ?? {};
      const spread = props.spread;
      const tempC = toNumber(props.tempC);
      if (spread === 'rapid' || (tempC !== null && tempC >= 400)) {
        addAlert(
          alerts,
          createAlert({
            id: `rule-disaster-fire-${String(props.id ?? 'wildfire')}`,
            domain: 'disaster',
            severity: 'critical',
            title: '산불 급속 확산',
            message: `화점 온도 ${tempC ?? '-'}°C, 확산 속도 급증. 인근 대피 절차를 시작하세요.`,
            coordinates: getPointCoordinates(feature),
          }),
          seen,
          diagnostics
        );
      }
    }
  }

  const quakeLayer = payload.layers.find((layer) => layer.id === 'disaster-earthquake-ripple');
  if (quakeLayer?.data) {
    for (const feature of quakeLayer.data.features) {
      const props = (feature.properties as Record<string, unknown> | null) ?? {};
      const magnitude = toNumber(props.magnitude);
      if (magnitude === null || magnitude < 3.5) continue;

      addAlert(
        alerts,
        createAlert({
          id: `rule-disaster-quake-${magnitude.toFixed(1)}`,
          domain: 'disaster',
          severity: magnitude >= 4.5 ? 'critical' : 'warning',
          title: '지진 감지 경보',
          message: `규모 ${magnitude.toFixed(1)} 지진 감지. 진앙지 인근 대피소 경로를 확인하세요.`,
          coordinates: getPointCoordinates(feature),
        }),
        seen,
        diagnostics
      );
    }
  }
}

function runHealthRules(
  payload: DomainPayload,
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  const erLayer = payload.layers.find((layer) => layer.id === 'health-er-capacity');
  if (!erLayer?.data) return;

  for (const feature of erLayer.data.features) {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const occupancyPct = toNumber(props.occupancyPct);
    if (occupancyPct === null || occupancyPct < 80) continue;

    const severity: AlertSeverity = occupancyPct >= 90 ? 'critical' : 'warning';
    addAlert(
      alerts,
      createAlert({
        id: `rule-health-er-${Math.round(occupancyPct)}-${String(props.id ?? 'hospital')}`,
        domain: 'health',
        severity,
        title: '응급실 수용 임계치 경보',
        message: `응급실 가동률 ${occupancyPct}% 상태. 인접 권역 분산 이송이 필요합니다.`,
        coordinates: getPointCoordinates(feature),
      }),
      seen,
      diagnostics
    );
  }
}

function runVulnerableRules(
  payload: DomainPayload,
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  const iotLayer = payload.layers.find((layer) => layer.id === 'vulnerable-emergency-iot');
  if (!iotLayer?.data) return;

  for (const feature of iotLayer.data.features) {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const lastHeartbeatMin = toNumber(props.lastHeartbeatMin);
    if (lastHeartbeatMin === null || lastHeartbeatMin < 25) continue;

    const severity: AlertSeverity = lastHeartbeatMin >= 40 ? 'critical' : 'warning';
    addAlert(
      alerts,
      createAlert({
        id: `rule-vulnerable-iot-${Math.round(lastHeartbeatMin)}-${String(props.id ?? 'sensor')}`,
        domain: 'vulnerable',
        severity,
        title: '사회적 약자 응급 신호',
        message: `IoT 무응답 ${lastHeartbeatMin}분 경과. 긴급 출동 확인이 필요합니다.`,
        coordinates: getPointCoordinates(feature),
      }),
      seen,
      diagnostics
    );
  }
}

function runInfraRules(
  payload: DomainPayload,
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  const gridLayer = payload.layers.find((layer) => layer.id === 'infra-grid-nodes');
  if (!gridLayer?.data) return;

  for (const feature of gridLayer.data.features) {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const loadPct = toNumber(props.loadPct);
    if (loadPct === null || loadPct < 85) continue;

    const severity: AlertSeverity = loadPct >= 95 ? 'critical' : 'warning';
    addAlert(
      alerts,
      createAlert({
        id: `rule-infra-load-${Math.round(loadPct)}-${String(props.id ?? 'node')}`,
        domain: 'infra',
        severity,
        title: '전력망 부하 임계치 경보',
        message: `전력 부하율 ${loadPct}% 도달. 수요 분산 및 비상 발전 대기 필요.`,
        coordinates: getPointCoordinates(feature),
      }),
      seen,
      diagnostics
    );
  }
}

function runCrimeRules(
  payload: DomainPayload,
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  const heatmapLayer = payload.layers.find((layer) => layer.id === 'crime-risk-heatmap');
  if (!heatmapLayer?.data) return;

  for (const feature of heatmapLayer.data.features) {
    const props = (feature.properties as Record<string, unknown> | null) ?? {};
    const weight = toNumber(props.weight);
    if (weight === null || weight < 0.85) continue;

    addAlert(
      alerts,
      createAlert({
        id: `rule-crime-risk-${String(props.id ?? 'zone')}`,
        domain: 'crime',
        severity: weight >= 0.95 ? 'critical' : 'warning',
        title: '범죄 위험도 급상승',
        message: `범죄 위험 지수 ${Math.round(weight * 100)}% 구역 감지. 순찰 강화 및 CCTV 우선 모니터링 권고.`,
        coordinates: getPointCoordinates(feature),
      }),
      seen,
      diagnostics
    );
  }
}

function runCrossDomainChainRules(
  alerts: AlertPayload[],
  seen: Set<string>,
  diagnostics: { generated: number; chained: number }
): void {
  // Chain 1: 기상 critical → 재난 침수 위험
  const hasCriticalWeather = alerts.some((alert) => alert.domain === 'weather' && alert.severity === 'critical');
  if (hasCriticalWeather) {
    addAlert(
      alerts,
      createAlert({
        id: 'chain-weather-disaster-flood',
        domain: 'disaster',
        severity: 'warning',
        title: '연쇄 경보: 침수 위험 상승',
        message: '기상 critical 경보와 연동되어 재난 도메인 침수 대응 단계를 상향했습니다.',
      }),
      seen,
      diagnostics,
      true
    );

    // Chain 1b: 폭우 → 도로 통제 + 대중교통 지연
    addAlert(
      alerts,
      createAlert({
        id: 'chain-weather-highway-control',
        domain: 'highway',
        severity: 'warning',
        title: '연쇄 경보: 도로 통제 권고',
        message: '집중호우로 인한 도로 침수 위험. 저지대 도로 통제 및 우회 경로 안내 필요.',
      }),
      seen,
      diagnostics,
      true
    );
    addAlert(
      alerts,
      createAlert({
        id: 'chain-weather-transit-delay',
        domain: 'transit',
        severity: 'info',
        title: '연쇄 이벤트: 대중교통 지연 예상',
        message: '기상 악화로 대중교통 운행 지연이 예상됩니다. 이용객 안내 방송을 준비하세요.',
      }),
      seen,
      diagnostics,
      true
    );
  }

  // Chain 2: 재난 critical → 의료 트리아지 + 구급차 출동
  const hasCriticalDisaster = alerts.some((alert) => alert.domain === 'disaster' && alert.severity === 'critical');
  if (hasCriticalDisaster) {
    addAlert(
      alerts,
      createAlert({
        id: 'chain-disaster-health-triage',
        domain: 'health',
        severity: 'warning',
        title: '연쇄 경보: 의료 트리아지 증원',
        message: '재난 critical 경보로 인한 환자 증가 가능성. 응급실 트리아지 인력 증원 권고.',
      }),
      seen,
      diagnostics,
      true
    );
  }

  // Chain 3: 사회적 약자 critical → CCTV 우선 추적
  const hasCriticalVulnerable = alerts.some(
    (alert) => alert.domain === 'vulnerable' && alert.severity === 'critical'
  );
  if (hasCriticalVulnerable) {
    addAlert(
      alerts,
      createAlert({
        id: 'chain-vulnerable-cctv-highlight',
        domain: 'cctv',
        severity: 'info',
        title: '연쇄 이벤트: CCTV 우선 추적',
        message: '사회적 약자 critical 경보를 감지해 인근 CCTV 레이어 우선 추적 이벤트를 생성했습니다.',
      }),
      seen,
      diagnostics,
      true
    );
  }

  // Chain 4: 지진 → 산불 위험 + 댐 수위 주의
  const hasEarthquake = alerts.some(
    (alert) => alert.domain === 'disaster' && alert.title.includes('지진')
  );
  if (hasEarthquake) {
    addAlert(
      alerts,
      createAlert({
        id: 'chain-earthquake-wildfire-risk',
        domain: 'disaster',
        severity: 'warning',
        title: '연쇄 경보: 지진 후 산불 위험',
        message: '지진으로 인한 가스관 파열 가능성. 산불 발생 위험 모니터링을 강화합니다.',
      }),
      seen,
      diagnostics,
      true
    );
    addAlert(
      alerts,
      createAlert({
        id: 'chain-earthquake-dam-watch',
        domain: 'infra',
        severity: 'warning',
        title: '연쇄 경보: 댐 수위 긴급 점검',
        message: '지진 발생으로 댐 구조물 안전 점검 및 수위 모니터링이 필요합니다.',
      }),
      seen,
      diagnostics,
      true
    );
  }

  // Chain 5: 대규모 교통사고 → 구급차 출동 + 병상 확보
  const hasCriticalTraffic = alerts.some(
    (alert) => alert.domain === 'highway' && alert.severity === 'critical'
  );
  if (hasCriticalTraffic) {
    addAlert(
      alerts,
      createAlert({
        id: 'chain-traffic-health-dispatch',
        domain: 'health',
        severity: 'warning',
        title: '연쇄 경보: 구급차 출동 대기',
        message: '교통 critical 경보 발생. 인근 구급차 출동 대기 및 응급실 병상 확보를 요청합니다.',
      }),
      seen,
      diagnostics,
      true
    );
  }

  // Chain 6: 인프라 critical → 사이버 경계 강화
  const hasCriticalInfra = alerts.some(
    (alert) => alert.domain === 'infra' && alert.severity === 'critical'
  );
  if (hasCriticalInfra) {
    addAlert(
      alerts,
      createAlert({
        id: 'chain-infra-cyber-alert',
        domain: 'cyber',
        severity: 'warning',
        title: '연쇄 경보: 사이버 방어 강화',
        message: '핵심 인프라 장애 감지. 사이버 공격 가능성 대비 보안 모니터링 단계를 상향합니다.',
      }),
      seen,
      diagnostics,
      true
    );
  }

  // Chain 7: 치안 critical → 순찰 강화 + CCTV 연동
  const hasCriticalCrime = alerts.some(
    (alert) => alert.domain === 'crime' && alert.severity === 'critical'
  );
  if (hasCriticalCrime) {
    addAlert(
      alerts,
      createAlert({
        id: 'chain-crime-cctv-priority',
        domain: 'cctv',
        severity: 'warning',
        title: '연쇄 경보: CCTV 집중 감시',
        message: '범죄 위험도 급상승 구역 CCTV 집중 모니터링 및 순찰 인력 투입을 권고합니다.',
      }),
      seen,
      diagnostics,
      true
    );
  }
}

export function applyAlertRules(payload: DomainPayload): {
  payload: DomainPayload;
  diagnostics: AlertRuleDiagnostics;
} {
  const alerts = [...payload.alerts];
  const diagnostics = { generated: 0, chained: 0 };
  const seen = new Set<string>(alerts.map((alert) => makeAlertKey(alert)));

  switch (payload.domain) {
    case 'traffic':
      runTrafficRules(payload, alerts, seen, diagnostics);
      break;
    case 'weather':
      runWeatherRules(payload, alerts, seen, diagnostics);
      break;
    case 'disaster':
      runDisasterRules(payload, alerts, seen, diagnostics);
      break;
    case 'health':
      runHealthRules(payload, alerts, seen, diagnostics);
      break;
    case 'vulnerable':
      runVulnerableRules(payload, alerts, seen, diagnostics);
      break;
    case 'infra':
      runInfraRules(payload, alerts, seen, diagnostics);
      break;
    case 'crime':
      runCrimeRules(payload, alerts, seen, diagnostics);
      break;
  }

  runCrossDomainChainRules(alerts, seen, diagnostics);

  return {
    payload: {
      ...payload,
      alerts,
    },
    diagnostics: {
      generated: diagnostics.generated,
      chained: diagnostics.chained,
      total: alerts.length,
    },
  };
}
