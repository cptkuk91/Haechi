// 해양 정적 인프라 Mock 데이터 — 항만, 위험구역, VTS 관제구역
// 실제 구현 시 해양수산부 API + 해사안전종합정보시스템 연동

const PORTS: Array<{
  name: string;
  lat: number;
  lng: number;
  type: 'trade' | 'fishing' | 'passenger';
  terminals: number;
}> = [
  { name: '부산항 신항', lat: 35.0747, lng: 128.8328, type: 'trade', terminals: 6 },
  { name: '부산항 북항', lat: 35.1053, lng: 129.0460, type: 'trade', terminals: 4 },
  { name: '인천항', lat: 37.4460, lng: 126.5955, type: 'trade', terminals: 5 },
  { name: '평택·당진항', lat: 36.9704, lng: 126.8238, type: 'trade', terminals: 3 },
  { name: '광양항', lat: 34.9133, lng: 127.6952, type: 'trade', terminals: 4 },
  { name: '울산항', lat: 35.5100, lng: 129.3870, type: 'trade', terminals: 3 },
  { name: '목포항', lat: 34.7876, lng: 126.3872, type: 'trade', terminals: 2 },
  { name: '포항항', lat: 36.0290, lng: 129.3750, type: 'trade', terminals: 2 },
  { name: '여수항', lat: 34.7353, lng: 127.7467, type: 'trade', terminals: 2 },
  { name: '동해항', lat: 37.4959, lng: 129.1204, type: 'trade', terminals: 1 },
  { name: '서귀포항', lat: 33.2386, lng: 126.5612, type: 'fishing', terminals: 1 },
  { name: '제주항', lat: 33.5194, lng: 126.5260, type: 'passenger', terminals: 2 },
  { name: '속초항', lat: 38.2033, lng: 128.5941, type: 'fishing', terminals: 1 },
  { name: '완도항', lat: 34.3112, lng: 126.7551, type: 'fishing', terminals: 1 },
];

// 해양 위험 구역 (공사, 사격, 암초)
const DANGER_ZONES: Array<{
  name: string;
  type: 'construction' | 'military' | 'reef' | 'restricted';
  coordinates: [number, number][];
}> = [
  {
    name: '부산 남항 공사구역',
    type: 'construction',
    coordinates: [
      [129.03, 35.08], [129.06, 35.08], [129.06, 35.06], [129.03, 35.06], [129.03, 35.08],
    ],
  },
  {
    name: '인천 앞바다 사격구역',
    type: 'military',
    coordinates: [
      [126.30, 37.35], [126.50, 37.35], [126.50, 37.25], [126.30, 37.25], [126.30, 37.35],
    ],
  },
  {
    name: '동해 주문진 사격구역',
    type: 'military',
    coordinates: [
      [128.85, 37.95], [129.05, 37.95], [129.05, 37.85], [128.85, 37.85], [128.85, 37.95],
    ],
  },
  {
    name: '서해 격렬비열도 위험해역',
    type: 'reef',
    coordinates: [
      [125.48, 36.05], [125.58, 36.05], [125.58, 35.95], [125.48, 35.95], [125.48, 36.05],
    ],
  },
  {
    name: '제주 남방 통항분리구역',
    type: 'restricted',
    coordinates: [
      [126.30, 33.10], [126.70, 33.10], [126.70, 33.00], [126.30, 33.00], [126.30, 33.10],
    ],
  },
];

// VTS (해상교통관제) 관할 구역
const VTS_CENTERS: Array<{
  name: string;
  lat: number;
  lng: number;
  coverageRadius: number; // km
}> = [
  { name: '부산 VTS', lat: 35.0800, lng: 129.0800, coverageRadius: 30 },
  { name: '인천 VTS', lat: 37.4500, lng: 126.5800, coverageRadius: 25 },
  { name: '여수 VTS', lat: 34.7400, lng: 127.7400, coverageRadius: 20 },
  { name: '울산 VTS', lat: 35.5000, lng: 129.4000, coverageRadius: 20 },
  { name: '평택 VTS', lat: 36.9700, lng: 126.8300, coverageRadius: 15 },
  { name: '목포 VTS', lat: 34.7900, lng: 126.3900, coverageRadius: 20 },
  { name: '포항 VTS', lat: 36.0300, lng: 129.3800, coverageRadius: 15 },
  { name: '마산 VTS', lat: 35.2000, lng: 128.5800, coverageRadius: 15 },
  { name: '대산 VTS', lat: 36.9200, lng: 126.3500, coverageRadius: 15 },
  { name: '동해 VTS', lat: 37.5000, lng: 129.1200, coverageRadius: 15 },
  { name: '제주 VTS', lat: 33.5200, lng: 126.5300, coverageRadius: 20 },
];

export function getPortsGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: PORTS.map((p, i) => ({
      type: 'Feature' as const,
      id: `port-${i}`,
      geometry: {
        type: 'Point' as const,
        coordinates: [p.lng, p.lat],
      },
      properties: {
        name: p.name,
        portType: p.type,
        terminals: p.terminals,
      },
    })),
  };
}

export function getDangerZonesGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: DANGER_ZONES.map((z, i) => ({
      type: 'Feature' as const,
      id: `danger-${i}`,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [z.coordinates],
      },
      properties: {
        name: z.name,
        dangerType: z.type,
      },
    })),
  };
}

function makeCircle(center: [number, number], radiusKm: number, points = 48): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = (radiusKm / 111.32) * Math.cos(angle);
    const dy = (radiusKm / (111.32 * Math.cos((center[1] * Math.PI) / 180))) * Math.sin(angle);
    coords.push([center[0] + dy, center[1] + dx]);
  }
  return coords;
}

export function getVTSGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      // VTS 센터 포인트
      ...VTS_CENTERS.map((v, i) => ({
        type: 'Feature' as const,
        id: `vts-center-${i}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [v.lng, v.lat] as [number, number],
        },
        properties: {
          name: v.name,
          type: 'vts-center',
          coverageRadius: v.coverageRadius,
        },
      })),
    ],
  };
}

export function getVTSCoverageGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: VTS_CENTERS.map((v, i) => ({
      type: 'Feature' as const,
      id: `vts-coverage-${i}`,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [makeCircle([v.lng, v.lat], v.coverageRadius)],
      },
      properties: {
        name: `${v.name} 관제구역`,
        type: 'vts-coverage',
        coverageRadius: v.coverageRadius,
      },
    })),
  };
}
