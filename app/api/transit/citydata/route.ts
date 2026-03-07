import { NextResponse } from 'next/server';
import { extractXmlItems, extractXmlTagValue } from '@/app/api/_shared/xml-utils';

// --- 서울시 주요 장소 목록 (API 호출 대상) ---
// 호출 제한(1000건/일) 고려하여 주요 장소만 선별
const AREA_LIST: { name: string; lng: number; lat: number }[] = [
  { name: '강남역', lng: 127.0276, lat: 37.4979 },
  { name: '홍대 관광특구', lng: 126.9246, lat: 37.5571 },
  { name: '명동 관광특구', lng: 126.9860, lat: 37.5636 },
  { name: '잠실 관광특구', lng: 127.1001, lat: 37.5145 },
  { name: '광화문·덕수궁', lng: 126.9769, lat: 37.5712 },
  { name: '서울역', lng: 126.9707, lat: 37.5547 },
  { name: '여의도', lng: 126.9256, lat: 37.5251 },
  { name: '이태원 관광특구', lng: 126.9944, lat: 37.5344 },
  { name: '동대문 관광특구', lng: 127.0094, lat: 37.5674 },
  { name: '신촌·이대역', lng: 126.9368, lat: 37.5597 },
  { name: '건대입구역', lng: 127.0691, lat: 37.5404 },
  { name: '종로·청계 관광특구', lng: 126.9900, lat: 37.5700 },
  { name: '가산디지털단지역', lng: 126.8826, lat: 37.4812 },
  { name: '북촌한옥마을', lng: 126.9820, lat: 37.5826 },
  { name: '성수카페거리', lng: 127.0556, lat: 37.5445 },
];

const API_KEY = process.env.TEAM2_TRAFFIC_SEOUL_INCIDENT_API_KEY ?? '';
const CACHE_TTL_MS = 5 * 60_000; // 5분

interface CachedData {
  timestamp: number;
  crowd: GeoJSON.Feature[];
  subway: GeoJSON.Feature[];
  bus: GeoJSON.Feature[];
  sbike: GeoJSON.Feature[];
}

let cache: CachedData | null = null;

// --- XML 파싱 헬퍼 ---
function tag(xml: string, name: string): string | null {
  return extractXmlTagValue(xml, name);
}

function tagNum(xml: string, name: string): number | null {
  const v = tag(xml, name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// --- 인구 혼잡도 파싱 ---
function parseCrowdFeature(
  xml: string,
  area: { name: string; lng: number; lat: number },
): GeoJSON.Feature<GeoJSON.Point> | null {
  const ppltnSection = extractXmlItems(xml, 'LIVE_PPLTN_STTS');
  // 중첩 구조: <LIVE_PPLTN_STTS><LIVE_PPLTN_STTS>...data...</LIVE_PPLTN_STTS></LIVE_PPLTN_STTS>
  const inner = ppltnSection.length > 0 ? ppltnSection[ppltnSection.length - 1] : xml;

  const congestionLevel = tag(inner, 'AREA_CONGEST_LVL');
  if (!congestionLevel) return null;

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [area.lng, area.lat] },
    properties: {
      id: `crowd-${area.name}`,
      name: area.name,
      congestionLevel,
      congestionMessage: tag(inner, 'AREA_CONGEST_MSG'),
      populationMin: tagNum(inner, 'AREA_PPLTN_MIN'),
      populationMax: tagNum(inner, 'AREA_PPLTN_MAX'),
      maleRate: tagNum(inner, 'MALE_PPLTN_RATE'),
      femaleRate: tagNum(inner, 'FEMALE_PPLTN_RATE'),
      residentRate: tagNum(inner, 'RESNT_PPLTN_RATE'),
      nonResidentRate: tagNum(inner, 'NON_RESNT_PPLTN_RATE'),
      updatedAt: tag(inner, 'PPLTN_TIME'),
      // 혼잡도 가중치 (히트맵용)
      weight: congestionLevel === '붐빔' ? 1.0
        : congestionLevel === '약간 붐빔' ? 0.7
        : congestionLevel === '보통' ? 0.4
        : 0.15,
    },
  };
}

// --- 지하철 승하차 파싱 ---
function parseSubwayFeatures(xml: string, areaName: string): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const stations = extractXmlItems(xml, 'SUB_STTS');

  for (const stn of stations) {
    // 외부 래퍼 <SUB_STTS> 안에 또 <SUB_STTS> 아이템들이 있는 구조 — 좌표가 있는 것만 처리
    const x = tagNum(stn, 'SUB_STN_X');
    const y = tagNum(stn, 'SUB_STN_Y');
    const name = tag(stn, 'SUB_STN_NM');
    if (x === null || y === null || !name) continue;

    const featureId = `sub-${areaName}-${name}-${tag(stn, 'SUB_STN_LINE') ?? ''}`;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [x, y] },
      properties: {
        id: featureId,
        name,
        line: tag(stn, 'SUB_STN_LINE'),
        area: areaName,
        address: tag(stn, 'SUB_STN_RADDR'),
      },
    });
  }

  // 승하차 인원 (LIVE_SUB_PPLTN — 장소 단위 집계)
  const liveSub = extractXmlItems(xml, 'LIVE_SUB_PPLTN');
  if (liveSub.length > 0 && features.length > 0) {
    const sub = liveSub[liveSub.length - 1];
    const passengers = {
      accumulatedBoardMin: tagNum(sub, 'SUB_ACML_GTON_PPLTN_MIN'),
      accumulatedBoardMax: tagNum(sub, 'SUB_ACML_GTON_PPLTN_MAX'),
      accumulatedAlightMin: tagNum(sub, 'SUB_ACML_GTOFF_PPLTN_MIN'),
      accumulatedAlightMax: tagNum(sub, 'SUB_ACML_GTOFF_PPLTN_MAX'),
      recent30mBoardMin: tagNum(sub, 'SUB_30WTHN_GTON_PPLTN_MIN'),
      recent30mBoardMax: tagNum(sub, 'SUB_30WTHN_GTON_PPLTN_MAX'),
      recent30mAlightMin: tagNum(sub, 'SUB_30WTHN_GTOFF_PPLTN_MIN'),
      recent30mAlightMax: tagNum(sub, 'SUB_30WTHN_GTOFF_PPLTN_MAX'),
    };
    // 승하차 정보를 모든 역 피처에 병합
    for (const f of features) {
      Object.assign(f.properties!, passengers);
    }
  }

  return features;
}

// --- 버스 승하차 파싱 ---
function parseBusFeatures(xml: string, areaName: string): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const stops = extractXmlItems(xml, 'BUS_STN_STTS');

  for (const stop of stops) {
    const x = tagNum(stop, 'BUS_STN_X');
    const y = tagNum(stop, 'BUS_STN_Y');
    const name = tag(stop, 'BUS_STN_NM');
    if (x === null || y === null || !name) continue;

    const arsId = tag(stop, 'BUS_ARS_ID') ?? '';
    const featureId = `bus-${areaName}-${arsId}`;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [x, y] },
      properties: {
        id: featureId,
        name,
        arsId,
        stationId: tag(stop, 'BUS_STN_ID'),
        area: areaName,
      },
    });
  }

  // 승하차 인원 (LIVE_BUS_PPLTN — 장소 단위 집계)
  const liveBus = extractXmlItems(xml, 'LIVE_BUS_PPLTN');
  if (liveBus.length > 0 && features.length > 0) {
    const bus = liveBus[liveBus.length - 1];
    const passengers = {
      accumulatedBoardMin: tagNum(bus, 'BUS_ACML_GTON_PPLTN_MIN'),
      accumulatedBoardMax: tagNum(bus, 'BUS_ACML_GTON_PPLTN_MAX'),
      accumulatedAlightMin: tagNum(bus, 'BUS_ACML_GTOFF_PPLTN_MIN'),
      accumulatedAlightMax: tagNum(bus, 'BUS_ACML_GTOFF_PPLTN_MAX'),
      recent30mBoardMin: tagNum(bus, 'BUS_30WTHN_GTON_PPLTN_MIN'),
      recent30mBoardMax: tagNum(bus, 'BUS_30WTHN_GTON_PPLTN_MAX'),
      recent30mAlightMin: tagNum(bus, 'BUS_30WTHN_GTOFF_PPLTN_MIN'),
      recent30mAlightMax: tagNum(bus, 'BUS_30WTHN_GTOFF_PPLTN_MAX'),
    };
    for (const f of features) {
      Object.assign(f.properties!, passengers);
    }
  }

  return features;
}

// --- 따릉이 파싱 ---
function parseSbikeFeatures(xml: string, areaName: string): GeoJSON.Feature<GeoJSON.Point>[] {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const spots = extractXmlItems(xml, 'SBIKE_STTS');

  for (const spot of spots) {
    const x = tagNum(spot, 'SBIKE_X');
    const y = tagNum(spot, 'SBIKE_Y');
    const name = tag(spot, 'SBIKE_SPOT_NM');
    if (x === null || y === null || !name) continue;

    const spotId = tag(spot, 'SBIKE_SPOT_ID') ?? '';
    const featureId = `sbike-${spotId}`;
    const parkingCnt = tagNum(spot, 'SBIKE_PARKING_CNT') ?? 0;
    const rackCnt = tagNum(spot, 'SBIKE_RACK_CNT') ?? 0;
    const shared = tagNum(spot, 'SBIKE_SHARED') ?? 0;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [x, y] },
      properties: {
        id: featureId,
        name,
        spotId,
        area: areaName,
        parkingCount: parkingCnt,
        rackCount: rackCnt,
        shared,
        available: Math.max(0, parkingCnt - rackCnt),
      },
    });
  }

  return features;
}

// --- 단일 장소 데이터 fetch ---
async function fetchAreaData(areaName: string): Promise<string | null> {
  const url = `http://openapi.seoul.go.kr:8088/${API_KEY}/xml/citydata/1/5/${encodeURIComponent(areaName)}`;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// --- 전체 데이터 수집 ---
async function collectAllData(): Promise<CachedData> {
  const crowd: GeoJSON.Feature[] = [];
  const subway: GeoJSON.Feature[] = [];
  const bus: GeoJSON.Feature[] = [];
  const sbike: GeoJSON.Feature[] = [];

  const dedupeSub = new Set<string>();
  const dedupeBus = new Set<string>();
  const dedupeSbike = new Set<string>();

  // 병렬 호출 (15개 장소를 3개씩 5 batch로)
  const batchSize = 3;
  for (let i = 0; i < AREA_LIST.length; i += batchSize) {
    const batch = AREA_LIST.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (area) => {
        const xml = await fetchAreaData(area.name);
        if (!xml) return null;

        // 결과 코드 확인
        const resultCode = tag(xml, 'RESULT.CODE');
        if (resultCode && resultCode !== 'INFO-000') return null;

        return { xml, area };
      }),
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { xml, area } = result.value;

      // 인구 혼잡도
      const crowdFeature = parseCrowdFeature(xml, area);
      if (crowdFeature) crowd.push(crowdFeature);

      // 지하철
      for (const f of parseSubwayFeatures(xml, area.name)) {
        const key = f.properties?.id as string;
        if (!dedupeSub.has(key)) {
          dedupeSub.add(key);
          subway.push(f);
        }
      }

      // 버스
      for (const f of parseBusFeatures(xml, area.name)) {
        const key = f.properties?.id as string;
        if (!dedupeBus.has(key)) {
          dedupeBus.add(key);
          bus.push(f);
        }
      }

      // 따릉이
      for (const f of parseSbikeFeatures(xml, area.name)) {
        const key = f.properties?.id as string;
        if (!dedupeSbike.has(key)) {
          dedupeSbike.add(key);
          sbike.push(f);
        }
      }
    }
  }

  return { timestamp: Date.now(), crowd, subway, bus, sbike };
}

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

export async function GET() {
  if (!API_KEY) {
    return NextResponse.json(
      {
        source: 'mock',
        updatedAt: new Date().toISOString(),
        crowd: fc([]),
        subway: fc([]),
        bus: fc([]),
        sbike: fc([]),
        warnings: ['Missing env: TEAM2_TRAFFIC_SEOUL_INCIDENT_API_KEY'],
      },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  }

  // 캐시가 유효하면 재사용
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(
      {
        source: 'upstream',
        updatedAt: new Date(cache.timestamp).toISOString(),
        crowd: fc(cache.crowd),
        subway: fc(cache.subway),
        bus: fc(cache.bus),
        sbike: fc(cache.sbike),
        warnings: [],
      },
      { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'upstream' } },
    );
  }

  const data = await collectAllData();
  cache = data;

  return NextResponse.json(
    {
      source: 'upstream',
      updatedAt: new Date(data.timestamp).toISOString(),
      crowd: fc(data.crowd),
      subway: fc(data.subway),
      bus: fc(data.bus),
      sbike: fc(data.sbike),
      warnings: [],
    },
    { headers: { 'cache-control': 'no-store, max-age=0', 'x-team2-source': 'upstream' } },
  );
}
