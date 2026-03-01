// 대중교통 정적 인프라 Mock 데이터 — 철도 노선, 역사, 지하철
// 실제 구현 시 코레일 API + 서울교통공사 API 연동

// KTX 노선 주요 경유지 (경부선)
const KTX_GYEONGBU: [number, number][] = [
  [126.9707, 37.5547], // 서울역
  [127.0045, 37.5133], // 용산
  [127.0557, 37.4162], // 광명
  [127.1060, 37.0114], // 천안아산
  [127.1271, 36.8085], // 오송
  [127.4341, 36.3324], // 대전
  [128.3260, 35.8868], // 김천구미
  [128.6255, 35.8770], // 동대구
  [128.9937, 35.5417], // 울산
  [129.0410, 35.1151], // 부산
];

// KTX 호남선
const KTX_HONAM: [number, number][] = [
  [126.9707, 37.5547], // 서울
  [127.0045, 37.5133], // 용산
  [127.0557, 37.4162], // 광명
  [127.1271, 36.8085], // 오송
  [127.0983, 36.1870], // 논산
  [126.6820, 35.9609], // 익산
  [126.7130, 35.8312], // 정읍
  [126.7924, 35.1374], // 광주송정
  [126.3923, 34.7505], // 목포
];

// 수도권 지하철 1호선 (간소화)
const SUBWAY_LINE_1: [number, number][] = [
  [127.0119, 37.7133], // 소요산
  [127.0459, 37.6380], // 의정부
  [127.0614, 37.6553], // 노원
  [127.0380, 37.6091], // 도봉산방면
  [127.0285, 37.5894], // 창동
  [127.0469, 37.5806], // 청량리
  [127.0094, 37.5674], // 동대문
  [126.9724, 37.5700], // 종로3가
  [126.9726, 37.5581], // 시청
  [126.9707, 37.5547], // 서울역
];

// 수도권 지하철 2호선 (간소화 — 순환선)
const SUBWAY_LINE_2: [number, number][] = [
  [126.9726, 37.5581], // 시청
  [126.9519, 37.5630], // 을지로입구
  [127.0094, 37.5674], // 동대문역사문화공원
  [127.0287, 37.5655], // 신당
  [127.0368, 37.5614], // 왕십리
  [127.0453, 37.5432], // 성수
  [127.0567, 37.5184], // 건대입구
  [127.0856, 37.5170], // 잠실나루
  [127.1001, 37.5145], // 잠실
  [127.0722, 37.4979], // 삼성
  [127.0276, 37.4979], // 강남
  [127.0025, 37.4842], // 서초
  [126.9818, 37.5016], // 방배
  [126.9527, 37.4849], // 사당
  [126.9314, 37.4902], // 낙성대
  [126.9520, 37.5046], // 서울대입구
  [126.9306, 37.5159], // 신림
  [126.9015, 37.4849], // 구로디지털단지
  [126.8951, 37.5088], // 대림
  [126.9034, 37.5175], // 신도림
  [126.9237, 37.5352], // 영등포구청
  [126.9200, 37.5435], // 당산
  [126.9263, 37.5497], // 합정
  [126.9246, 37.5571], // 홍대입구
  [126.9368, 37.5597], // 신촌
  [126.9438, 37.5564], // 이대
  [126.9519, 37.5630], // 을지로입구 (순환)
  [126.9726, 37.5581], // 시청 (순환)
];

// 주요 역사
const STATIONS: Array<{
  name: string;
  lat: number;
  lng: number;
  type: 'ktx' | 'subway' | 'general';
  lines: string[];
  transfer: boolean;
}> = [
  { name: '서울역', lat: 37.5547, lng: 126.9707, type: 'ktx', lines: ['경부선', '1호선', '4호선', '공항철도'], transfer: true },
  { name: '용산역', lat: 37.5133, lng: 127.0045, type: 'ktx', lines: ['경부선', '1호선', '중앙선'], transfer: true },
  { name: '광명역', lat: 37.4162, lng: 127.0557, type: 'ktx', lines: ['경부고속선'], transfer: false },
  { name: '대전역', lat: 36.3324, lng: 127.4341, type: 'ktx', lines: ['경부선', '1호선'], transfer: true },
  { name: '동대구역', lat: 35.8770, lng: 128.6255, type: 'ktx', lines: ['경부선', '1호선'], transfer: true },
  { name: '부산역', lat: 35.1151, lng: 129.0410, type: 'ktx', lines: ['경부선', '1호선'], transfer: true },
  { name: '광주송정역', lat: 35.1374, lng: 126.7924, type: 'ktx', lines: ['호남선'], transfer: false },
  { name: '목포역', lat: 34.7505, lng: 126.3923, type: 'ktx', lines: ['호남선'], transfer: false },
  { name: '강남역', lat: 37.4979, lng: 127.0276, type: 'subway', lines: ['2호선', '신분당선'], transfer: true },
  { name: '홍대입구역', lat: 37.5571, lng: 126.9246, type: 'subway', lines: ['2호선', '공항철도'], transfer: true },
  { name: '잠실역', lat: 37.5145, lng: 127.1001, type: 'subway', lines: ['2호선', '8호선'], transfer: true },
  { name: '신도림역', lat: 37.5088, lng: 126.8951, type: 'subway', lines: ['1호선', '2호선'], transfer: true },
  { name: '왕십리역', lat: 37.5614, lng: 127.0368, type: 'subway', lines: ['2호선', '5호선', '중앙선', '분당선'], transfer: true },
  { name: '사당역', lat: 37.4849, lng: 126.9527, type: 'subway', lines: ['2호선', '4호선'], transfer: true },
  { name: '종로3가역', lat: 37.5700, lng: 126.9724, type: 'subway', lines: ['1호선', '3호선', '5호선'], transfer: true },
];

export function getKTXRoutesGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature' as const,
        id: 'ktx-gyeongbu',
        geometry: { type: 'LineString' as const, coordinates: KTX_GYEONGBU },
        properties: { name: 'KTX 경부선', line: 'gyeongbu', color: '#0052A4' },
      },
      {
        type: 'Feature' as const,
        id: 'ktx-honam',
        geometry: { type: 'LineString' as const, coordinates: KTX_HONAM },
        properties: { name: 'KTX 호남선', line: 'honam', color: '#009D3E' },
      },
    ],
  };
}

export function getSubwayRoutesGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature' as const,
        id: 'subway-line-1',
        geometry: { type: 'LineString' as const, coordinates: SUBWAY_LINE_1 },
        properties: { name: '수도권 1호선', line: '1', color: '#0052A4' },
      },
      {
        type: 'Feature' as const,
        id: 'subway-line-2',
        geometry: { type: 'LineString' as const, coordinates: SUBWAY_LINE_2 },
        properties: { name: '수도권 2호선', line: '2', color: '#00A84D' },
      },
    ],
  };
}

export function getStationsGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: STATIONS.map((s, i) => ({
      type: 'Feature' as const,
      id: `station-${i}`,
      geometry: {
        type: 'Point' as const,
        coordinates: [s.lng, s.lat],
      },
      properties: {
        name: s.name,
        stationType: s.type,
        lines: s.lines,
        transfer: s.transfer,
      },
    })),
  };
}
