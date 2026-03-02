import type {
  AlertPayload,
  DomainPayload,
  LayerPayload,
  Team2DomainRoute,
} from '@/app/api/_shared/domain-payload';
import type { AlertSeverity, DomainType, LayerType } from '@/types/domain';

const TM_A = 6378137;
const TM_F = 1 / 298.257222101;
const TM_E2 = 2 * TM_F - TM_F * TM_F;
const TM_EP2 = TM_E2 / (1 - TM_E2);
const TM_K0 = 1;
const TM_LON0 = (127 * Math.PI) / 180;
const TM_LAT0 = (38 * Math.PI) / 180;
const TM_X0 = 200000;
const TM_Y0 = 500000;

const TRAFFIC_RESULT_CODE_HINTS: Record<string, string> = {
  'INFO-000': '정상 처리되었습니다.',
  'INFO-100': '인증키가 유효하지 않습니다. KEY 값을 확인하세요.',
  'INFO-200': '해당하는 데이터가 없습니다.',
  'ERROR-300': '필수 값 누락. KEY/TYPE/SERVICE/START_INDEX/END_INDEX를 확인하세요.',
  'ERROR-301': 'TYPE 값 오류. xml로 요청했는지 확인하세요.',
  'ERROR-310': 'SERVICE 값 오류. SERVICE=AccInfo인지 확인하세요.',
  'ERROR-331': 'START_INDEX 값을 확인하세요.',
  'ERROR-332': 'END_INDEX 값을 확인하세요.',
  'ERROR-333': 'START_INDEX/END_INDEX 타입 오류. 정수여야 합니다.',
  'ERROR-334': 'START_INDEX가 END_INDEX보다 큽니다.',
  'ERROR-335': 'sample 키는 최대 5건만 요청 가능합니다.',
  'ERROR-336': '한 번에 최대 1000건만 요청 가능합니다.',
  'ERROR-500': '서버 오류입니다. 잠시 후 재시도하세요.',
  'ERROR-600': 'DB 연결 오류입니다. 잠시 후 재시도하세요.',
  'ERROR-601': 'SQL 오류입니다. 잠시 후 재시도하세요.',
};

export interface TrafficResultStatus {
  code: string | null;
  message: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function inferCoordinates(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = toNumber(value[0]);
  const lat = toNumber(value[1]);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}

function toAlertSeverity(value: unknown): AlertSeverity {
  if (value === 'info' || value === 'warning' || value === 'critical') return value;
  return 'info';
}

function inferDomain(value: unknown, fallback: DomainType): DomainType {
  const known: DomainType[] = [
    'aviation',
    'cctv',
    'maritime',
    'transit',
    'defense',
    'cyber',
    'highway',
    'disaster',
    'weather',
    'crime',
    'health',
    'infra',
    'vulnerable',
  ];

  if (typeof value === 'string' && known.includes(value as DomainType)) {
    return value as DomainType;
  }
  return fallback;
}

function inferLayerType(value: unknown, fallback: LayerType): LayerType {
  const known: LayerType[] = ['marker', 'polygon', 'line', 'heatmap', 'particle', 'arc', 'icon', 'column'];
  if (typeof value === 'string' && known.includes(value as LayerType)) {
    return value as LayerType;
  }
  return fallback;
}

function featureFromRecord(record: Record<string, unknown>, index: number): GeoJSON.Feature | null {
  if (record.type === 'Feature' && isObject(record.geometry)) {
    return record as unknown as GeoJSON.Feature;
  }

  const directGeometry = record.geometry;
  if (isObject(directGeometry) && typeof directGeometry.type === 'string' && Array.isArray(directGeometry.coordinates)) {
    return {
      type: 'Feature',
      geometry: directGeometry as unknown as GeoJSON.Geometry,
      properties: isObject(record.properties) ? record.properties : {},
    };
  }

  const pointCoords =
    inferCoordinates(record.coordinates) ?? inferCoordinates([record.lng ?? record.lon, record.lat]);

  if (pointCoords) {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: pointCoords,
      },
      properties: {
        id: record.id ?? `feature-${index}`,
        ...(isObject(record.properties) ? record.properties : {}),
      },
    };
  }

  return null;
}

function normalizeFeatureCollection(value: unknown): GeoJSON.FeatureCollection {
  if (isObject(value) && value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value as unknown as GeoJSON.FeatureCollection;
  }

  const source = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.features)
      ? value.features
      : isObject(value) && Array.isArray(value.items)
        ? value.items
        : [];

  const features = source
    .map((item, index) => (isObject(item) ? featureFromRecord(item, index) : null))
    .filter((item): item is GeoJSON.Feature => item !== null);

  return { type: 'FeatureCollection', features };
}

function normalizeLayer(
  layerRaw: unknown,
  index: number,
  defaultDomain: DomainType
): LayerPayload | null {
  if (!isObject(layerRaw)) return null;

  const id = typeof layerRaw.id === 'string' ? layerRaw.id : `upstream-layer-${index}`;
  const name = typeof layerRaw.name === 'string' ? layerRaw.name : id;
  const domain = inferDomain(layerRaw.domain, defaultDomain);
  const type = inferLayerType(layerRaw.type, 'marker');
  const visible = layerRaw.visible !== false;

  const style = isObject(layerRaw.style)
    ? {
        color: layerRaw.style.color as LayerPayload['style']['color'],
        radius: toNumber(layerRaw.style.radius) ?? undefined,
        lineWidth: toNumber(layerRaw.style.lineWidth) ?? undefined,
        opacity: toNumber(layerRaw.style.opacity) ?? undefined,
        elevation: toNumber(layerRaw.style.elevation) ?? undefined,
      }
    : {};

  const dataCandidate =
    layerRaw.data ?? (Array.isArray(layerRaw.features) ? layerRaw.features : layerRaw.items ?? []);

  const data = normalizeFeatureCollection(dataCandidate);

  return {
    id,
    domain,
    name,
    type,
    visible,
    style,
    data,
  };
}

function normalizeAlert(alertRaw: unknown, index: number, defaultDomain: DomainType): AlertPayload | null {
  if (!isObject(alertRaw)) return null;

  return {
    id: typeof alertRaw.id === 'string' ? alertRaw.id : `alert-${index}`,
    severity: toAlertSeverity(alertRaw.severity),
    domain: inferDomain(alertRaw.domain, defaultDomain),
    title: typeof alertRaw.title === 'string' ? alertRaw.title : 'External Alert',
    message: typeof alertRaw.message === 'string' ? alertRaw.message : 'Alert received from upstream source.',
    coordinates: inferCoordinates(alertRaw.coordinates) ?? undefined,
  };
}

function normalizeMetrics(value: unknown): DomainPayload['metrics'] {
  if (!Array.isArray(value)) return [];

  const metrics: DomainPayload['metrics'] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const label = typeof item.label === 'string' ? item.label : null;
    const metricValue =
      typeof item.value === 'string' || typeof item.value === 'number' ? String(item.value) : null;
    if (!label || !metricValue) continue;

    metrics.push({
      label,
      value: metricValue,
      severity: toAlertSeverity(item.severity),
    });
  }

  return metrics;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, num) => String.fromCharCode(Number(num)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractXmlTagValue(source: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = source.match(re);
  if (!match?.[1]) return null;
  return decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim();
}

export function getTrafficResultStatus(raw: unknown): TrafficResultStatus | null {
  if (typeof raw !== 'string') return null;
  if (!raw.includes('<AccInfo')) return null;

  return {
    code: extractXmlTagValue(raw, 'CODE'),
    message: extractXmlTagValue(raw, 'MESSAGE'),
  };
}

export function formatTrafficResultWarning(status: TrafficResultStatus): string | null {
  const code = status.code;
  if (!code || code === 'INFO-000') return null;

  const defaultHint = TRAFFIC_RESULT_CODE_HINTS[code];
  const message = status.message ?? defaultHint ?? 'API 응답 코드를 확인하세요.';

  return `[traffic:${code}] ${message}`;
}

function normalizeTimeToken(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 6) return digits;
  if (digits.length === 4) return `${digits}00`;
  if (digits.length === 2) return `${digits}0000`;
  if (digits.length === 1) return `0${digits}0000`;
  return '000000';
}

function meridionalArc(phi: number): number {
  return TM_A * (
    (1 - TM_E2 / 4 - (3 * TM_E2 ** 2) / 64 - (5 * TM_E2 ** 3) / 256) * phi
    - ((3 * TM_E2) / 8 + (3 * TM_E2 ** 2) / 32 + (45 * TM_E2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * TM_E2 ** 2) / 256 + (45 * TM_E2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * TM_E2 ** 3) / 3072) * Math.sin(6 * phi)
  );
}

function convertGrs80TmToWgs84(x: number, y: number): [number, number] | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const m0 = meridionalArc(TM_LAT0);
  const m = m0 + (y - TM_Y0) / TM_K0;
  const mu = m / (TM_A * (1 - TM_E2 / 4 - (3 * TM_E2 ** 2) / 64 - (5 * TM_E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - TM_E2)) / (1 + Math.sqrt(1 - TM_E2));

  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const c1 = TM_EP2 * Math.cos(phi1) ** 2;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = TM_A / Math.sqrt(1 - TM_E2 * Math.sin(phi1) ** 2);
  const r1 = (TM_A * (1 - TM_E2)) / Math.pow(1 - TM_E2 * Math.sin(phi1) ** 2, 1.5);
  const d = (x - TM_X0) / (n1 * TM_K0);

  const lat = phi1 - ((n1 * Math.tan(phi1)) / r1) * (
    d ** 2 / 2
    - ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * TM_EP2) * d ** 4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * TM_EP2 - 3 * c1 ** 2) * d ** 6) / 720
  );

  const lon = TM_LON0 + (
    d
    - ((1 + 2 * t1 + c1) * d ** 3) / 6
    + ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * TM_EP2 + 24 * t1 ** 2) * d ** 5) / 120
  ) / Math.cos(phi1);

  const lngDeg = (lon * 180) / Math.PI;
  const latDeg = (lat * 180) / Math.PI;

  if (lngDeg < 124 || lngDeg > 132 || latDeg < 33 || latDeg > 40) return null;
  return [Number(lngDeg.toFixed(6)), Number(latDeg.toFixed(6))];
}

function classifyTrafficIncidentSeverity(
  accType: string | null,
  accDType: string | null,
  accInfo: string
): AlertSeverity {
  const type = (accType ?? '').toUpperCase();
  const dtype = (accDType ?? '').toUpperCase();

  let severity: AlertSeverity = 'warning';
  if (type === 'A10') severity = 'info';
  else if (type === 'A01') severity = 'critical';
  else if (type === 'A04') severity = 'warning';

  if (dtype.startsWith('10')) {
    severity = 'info';
  }

  const normalizedInfo = accInfo.replace(/\s+/g, ' ').trim();
  const criticalPattern = /양방향\s*전면통제|전면\s*통제|전면\s*차단|통행\s*불가|추돌|충돌|화재|붕괴|침수|인명/;
  const warningPattern = /차로\s*통제|부분\s*통제|공사|시설물|보수|우회|행사|집회|차\s*없는\s*거리|통제/;

  if (criticalPattern.test(normalizedInfo)) return 'critical';
  if (warningPattern.test(normalizedInfo) && severity === 'info') return 'warning';

  return severity;
}

function buildEmptyTrafficPayload(reason?: string): DomainPayload {
  return {
    domain: 'traffic',
    updatedAt: new Date().toISOString(),
    layers: [
      {
        id: 'highway-incidents',
        domain: 'highway',
        name: '서울 실시간 돌발정보',
        type: 'marker',
        visible: true,
        style: { color: '#ff3344', radius: 780 },
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      },
    ],
    alerts: [],
    metrics: [
      { label: '서울 돌발건수', value: '0', severity: 'info' },
      ...(reason ? [{ label: '상태', value: reason, severity: 'info' as const }] : []),
    ],
  };
}

function normalizeTrafficXmlPayload(xml: string): DomainPayload | null {
  if (!xml.includes('<AccInfo')) return null;

  const resultStatus = getTrafficResultStatus(xml);
  const resultCode = resultStatus?.code;

  if (resultCode === 'INFO-200') {
    return buildEmptyTrafficPayload(resultStatus?.message ?? TRAFFIC_RESULT_CODE_HINTS['INFO-200']);
  }

  if (resultCode && resultCode !== 'INFO-000') return null;

  const rowMatches = xml.match(/<row>[\s\S]*?<\/row>/gi) ?? [];
  if (rowMatches.length === 0) {
    return buildEmptyTrafficPayload('응답 데이터가 없습니다.');
  }

  const incidentFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const rowXml of rowMatches) {
    const accId = extractXmlTagValue(rowXml, 'acc_id');
    if (!accId) continue;

    const accInfo = extractXmlTagValue(rowXml, 'acc_info') ?? '서울 실시간 돌발 정보';
    const accType = extractXmlTagValue(rowXml, 'acc_type');
    const accDType = extractXmlTagValue(rowXml, 'acc_dtype');
    const occrDate = extractXmlTagValue(rowXml, 'occr_date');
    const occrTime = normalizeTimeToken(extractXmlTagValue(rowXml, 'occr_time'));
    const expClrDate = extractXmlTagValue(rowXml, 'exp_clr_date');
    const expClrTime = normalizeTimeToken(extractXmlTagValue(rowXml, 'exp_clr_time'));
    const linkId = extractXmlTagValue(rowXml, 'link_id');

    const x = toNumber(extractXmlTagValue(rowXml, 'grs80tm_x'));
    const y = toNumber(extractXmlTagValue(rowXml, 'grs80tm_y'));
    const coordinates = x !== null && y !== null ? convertGrs80TmToWgs84(x, y) : null;
    if (!coordinates) continue;

    const severity = classifyTrafficIncidentSeverity(accType, accDType, accInfo);
    if (severity === 'critical') criticalCount += 1;
    else if (severity === 'warning') warningCount += 1;
    else infoCount += 1;

    const compactInfo = accInfo.replace(/\s+/g, ' ').trim();
    const title =
      compactInfo.length > 28
        ? `${compactInfo.slice(0, 28).trim()}...`
        : compactInfo;

    incidentFeatures.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates,
      },
      properties: {
        id: `seoul-acc-${accId}`,
        title,
        accInfo: compactInfo,
        severity,
        accType,
        accDType,
        linkId,
        occrDate,
        occrTime,
        expClrDate,
        expClrTime,
      },
    });
  }

  if (incidentFeatures.length === 0) return null;

  const totalCount = toNumber(extractXmlTagValue(xml, 'list_total_count')) ?? incidentFeatures.length;

  return {
    domain: 'traffic',
    updatedAt: new Date().toISOString(),
    layers: [
      {
        id: 'highway-incidents',
        domain: 'highway',
        name: '서울 실시간 돌발정보',
        type: 'marker',
        visible: true,
        style: { color: '#ff3344', radius: 780 },
        data: {
          type: 'FeatureCollection',
          features: incidentFeatures,
        },
      },
    ],
    alerts: [],
    metrics: [
      {
        label: '서울 돌발건수',
        value: String(Math.round(totalCount)),
        severity: criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : undefined,
      },
      { label: 'Critical', value: String(criticalCount), severity: 'critical' },
      { label: 'Warning', value: String(warningCount), severity: warningCount > 0 ? 'warning' : undefined },
      { label: 'Info', value: String(infoCount) },
    ],
  };
}

function routeToDomain(route: Team2DomainRoute): DomainType {
  switch (route) {
    case 'traffic':
      return 'highway';
    case 'weather':
      return 'weather';
    case 'disaster':
      return 'disaster';
    case 'infra':
      return 'infra';
    case 'crime':
      return 'crime';
    case 'health':
      return 'health';
    case 'vulnerable':
      return 'vulnerable';
  }
}

export function normalizeUpstreamPayload(
  route: Team2DomainRoute,
  raw: unknown
): DomainPayload | null {
  if (route === 'traffic' && typeof raw === 'string') {
    const xmlPayload = normalizeTrafficXmlPayload(raw);
    if (xmlPayload) return xmlPayload;
  }

  if (!isObject(raw)) return null;

  const domainFallback = routeToDomain(route);
  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];

  const layers = rawLayers
    .map((layer, index) => normalizeLayer(layer, index, domainFallback))
    .filter((layer): layer is LayerPayload => layer !== null);

  if (layers.length === 0) {
    return null;
  }

  const alertsRaw = Array.isArray(raw.alerts) ? raw.alerts : [];
  const alerts = alertsRaw
    .map((alert, index) => normalizeAlert(alert, index, domainFallback))
    .filter((alert): alert is AlertPayload => alert !== null);

  return {
    domain: route,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    layers,
    alerts,
    metrics: normalizeMetrics(raw.metrics),
  };
}
