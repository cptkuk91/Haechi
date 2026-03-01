// 비행금지구역 / MDL / KADIZ / UXO 경고구역 Mock 데이터
// 실제 구현 시 V-World 공간정보 + 국방부 공개 데이터 연동

// 비행금지구역 (P-73 서울 등)
const NO_FLY_ZONES: Array<{
  name: string;
  code: string;
  altitudeMax: number; // feet
  coordinates: [number, number][];
}> = [
  {
    name: '서울 비행금지구역 (P-73A)',
    code: 'P-73A',
    altitudeMax: 0, // SFC to UNL
    coordinates: [
      [126.88, 37.60], [127.01, 37.60], [127.08, 37.56],
      [127.08, 37.50], [127.01, 37.46], [126.88, 37.46],
      [126.82, 37.50], [126.82, 37.56], [126.88, 37.60],
    ],
  },
  {
    name: '용산 비행금지구역 (P-73B)',
    code: 'P-73B',
    altitudeMax: 0,
    coordinates: [
      [126.96, 37.55], [127.00, 37.55], [127.00, 37.52],
      [126.96, 37.52], [126.96, 37.55],
    ],
  },
  {
    name: '원전 비행금지구역 (고리)',
    code: 'P-61',
    altitudeMax: 2000,
    coordinates: [
      [129.27, 35.35], [129.35, 35.35], [129.35, 35.29],
      [129.27, 35.29], [129.27, 35.35],
    ],
  },
  {
    name: '원전 비행금지구역 (월성)',
    code: 'P-62',
    altitudeMax: 2000,
    coordinates: [
      [129.43, 35.73], [129.51, 35.73], [129.51, 35.67],
      [129.43, 35.67], [129.43, 35.73],
    ],
  },
  {
    name: '인천공항 비행금지구역',
    code: 'P-518',
    altitudeMax: 5000,
    coordinates: [
      [126.36, 37.50], [126.52, 37.50], [126.52, 37.42],
      [126.36, 37.42], [126.36, 37.50],
    ],
  },
];

// 군사분계선 (MDL) 근사 좌표
const MDL_COORDINATES: [number, number][] = [
  [126.10, 37.77], [126.30, 37.80], [126.50, 37.85],
  [126.68, 37.90], [126.80, 37.93], [126.92, 37.95],
  [127.05, 37.97], [127.20, 38.00], [127.40, 38.05],
  [127.60, 38.10], [127.80, 38.15], [128.00, 38.20],
  [128.20, 38.25], [128.40, 38.30], [128.60, 38.35],
  [128.80, 38.40], [129.00, 38.45], [129.20, 38.50],
  [129.40, 38.55], [129.60, 38.60],
];

// NLL (북방한계선) — 서해
const NLL_WEST_SEA: [number, number][] = [
  [124.60, 37.75], [125.00, 37.80], [125.40, 37.85],
  [125.80, 37.88], [126.10, 37.77],
];

// KADIZ (한국 방공식별구역) 근사 경계
const KADIZ_BOUNDARY: [number, number][] = [
  [120.0, 39.0], [132.0, 39.0], [132.0, 33.0],
  [128.0, 30.0], [124.0, 30.0], [120.0, 33.0],
  [120.0, 39.0],
];

// UXO (불발탄) 경고 구역
const UXO_ZONES: Array<{
  name: string;
  dangerLevel: 'high' | 'medium' | 'low';
  center: [number, number];
  radius: number; // km
}> = [
  { name: '철원 GP 인근', dangerLevel: 'high', center: [127.31, 38.15], radius: 5 },
  { name: '파주 문산 인근', dangerLevel: 'high', center: [126.78, 37.86], radius: 3 },
  { name: '연천 전곡리', dangerLevel: 'medium', center: [127.07, 38.02], radius: 4 },
  { name: '양구 DMZ 남측', dangerLevel: 'high', center: [127.99, 38.10], radius: 6 },
  { name: '인제 진부령', dangerLevel: 'medium', center: [128.18, 38.25], radius: 3 },
  { name: '고성 통일전망대', dangerLevel: 'medium', center: [128.37, 38.35], radius: 2 },
];

export function getNoFlyZonesGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: NO_FLY_ZONES.map((zone, i) => ({
      type: 'Feature' as const,
      id: `nfz-${i}`,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [zone.coordinates],
      },
      properties: {
        name: zone.name,
        code: zone.code,
        altitudeMax: zone.altitudeMax,
        zoneType: 'no-fly',
      },
    })),
  };
}

export function getMDLGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature' as const,
        id: 'mdl-main',
        geometry: {
          type: 'LineString' as const,
          coordinates: MDL_COORDINATES,
        },
        properties: {
          name: '군사분계선 (MDL)',
          type: 'mdl',
        },
      },
      {
        type: 'Feature' as const,
        id: 'nll-west',
        geometry: {
          type: 'LineString' as const,
          coordinates: NLL_WEST_SEA,
        },
        properties: {
          name: '북방한계선 (NLL) — 서해',
          type: 'nll',
        },
      },
    ],
  };
}

export function getKADIZGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature' as const,
        id: 'kadiz',
        geometry: {
          type: 'Polygon' as const,
          coordinates: [KADIZ_BOUNDARY],
        },
        properties: {
          name: 'KADIZ 방공식별구역',
          type: 'kadiz',
        },
      },
    ],
  };
}

function makeCirclePolygon(center: [number, number], radiusKm: number, points = 32): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = (radiusKm / 111.32) * Math.cos(angle);
    const dy = (radiusKm / (111.32 * Math.cos((center[1] * Math.PI) / 180))) * Math.sin(angle);
    coords.push([center[0] + dy, center[1] + dx]);
  }
  return coords;
}

export function getUXOZonesGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: UXO_ZONES.map((zone, i) => ({
      type: 'Feature' as const,
      id: `uxo-${i}`,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [makeCirclePolygon(zone.center, zone.radius)],
      },
      properties: {
        name: zone.name,
        dangerLevel: zone.dangerLevel,
        radiusKm: zone.radius,
        zoneType: 'uxo',
      },
    })),
  };
}
