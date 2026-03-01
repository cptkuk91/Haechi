// CCTV 마커 Mock 데이터 — 전국 주요 도시 CCTV 위치
// 실제 구현 시 국가교통정보센터 CCTV API + 지자체 방범 CCTV API 연동

const CCTV_RAW: Array<{
  name: string;
  lat: number;
  lng: number;
  type: 'traffic' | 'security' | 'disaster';
  status: 'active' | 'inactive' | 'maintenance';
  streamUrl?: string;
}> = [
  // 서울
  { name: '강남역 교차로', lat: 37.4979, lng: 127.0276, type: 'traffic', status: 'active', streamUrl: 'https://its.go.kr/stream/01' },
  { name: '광화문 사거리', lat: 37.5712, lng: 126.9769, type: 'traffic', status: 'active', streamUrl: 'https://its.go.kr/stream/02' },
  { name: '서울역 광장', lat: 37.5547, lng: 126.9707, type: 'security', status: 'active' },
  { name: '홍대입구역', lat: 37.5571, lng: 126.9246, type: 'security', status: 'active' },
  { name: '잠실 올림픽대로', lat: 37.5145, lng: 127.1001, type: 'traffic', status: 'active' },
  { name: '여의도 IFC', lat: 37.5251, lng: 126.9256, type: 'security', status: 'maintenance' },
  { name: '명동 중앙로', lat: 37.5636, lng: 126.9860, type: 'security', status: 'active' },
  { name: '동대문 DDP', lat: 37.5674, lng: 127.0094, type: 'security', status: 'active' },
  { name: '이태원역', lat: 37.5344, lng: 126.9944, type: 'security', status: 'active' },
  { name: '청량리역', lat: 37.5806, lng: 127.0469, type: 'traffic', status: 'active' },
  { name: '노원역', lat: 37.6553, lng: 127.0614, type: 'traffic', status: 'active' },
  { name: '신촌 연세로', lat: 37.5597, lng: 126.9368, type: 'security', status: 'active' },
  { name: '구로디지털단지', lat: 37.4849, lng: 126.9015, type: 'traffic', status: 'inactive' },
  { name: '송파 롯데타워', lat: 37.5126, lng: 127.1026, type: 'security', status: 'active' },
  { name: '마포대교', lat: 37.5316, lng: 126.9448, type: 'disaster', status: 'active' },

  // 부산
  { name: '해운대 해수욕장', lat: 35.1587, lng: 129.1604, type: 'security', status: 'active' },
  { name: '광안리 해수욕장', lat: 35.1531, lng: 129.1186, type: 'security', status: 'active' },
  { name: '부산역 광장', lat: 35.1151, lng: 129.0410, type: 'traffic', status: 'active' },
  { name: '서면 교차로', lat: 35.1578, lng: 129.0589, type: 'traffic', status: 'active' },
  { name: '남포동 BIFF', lat: 35.0984, lng: 129.0254, type: 'security', status: 'active' },
  { name: '센텀시티', lat: 35.1694, lng: 129.1316, type: 'security', status: 'active' },

  // 인천
  { name: '인천국제공항 T1', lat: 37.4602, lng: 126.4407, type: 'traffic', status: 'active', streamUrl: 'https://its.go.kr/stream/10' },
  { name: '송도 센트럴파크', lat: 37.3916, lng: 126.6603, type: 'security', status: 'active' },
  { name: '부평역 지하상가', lat: 37.4901, lng: 126.7234, type: 'security', status: 'active' },

  // 대구
  { name: '동성로 입구', lat: 35.8687, lng: 128.5933, type: 'security', status: 'active' },
  { name: '대구역', lat: 35.8787, lng: 128.6248, type: 'traffic', status: 'active' },

  // 대전
  { name: '대전역 서광장', lat: 36.3324, lng: 127.4341, type: 'traffic', status: 'active' },
  { name: '유성온천역', lat: 36.3554, lng: 127.3361, type: 'traffic', status: 'active' },

  // 광주
  { name: '충장로 입구', lat: 35.1497, lng: 126.9162, type: 'security', status: 'active' },
  { name: '광주송정역', lat: 35.1374, lng: 126.7924, type: 'traffic', status: 'active' },

  // 울산
  { name: '울산 현대중공업', lat: 35.5126, lng: 129.3862, type: 'security', status: 'active' },

  // 제주
  { name: '제주공항', lat: 33.5104, lng: 126.4914, type: 'traffic', status: 'active' },
  { name: '제주 탑동 해안', lat: 33.5200, lng: 126.5247, type: 'disaster', status: 'active' },

  // 고속도로 주요 지점
  { name: '경부고속도로 신탄진IC', lat: 36.3945, lng: 127.4204, type: 'traffic', status: 'active', streamUrl: 'https://its.go.kr/stream/20' },
  { name: '서해안고속도로 서산IC', lat: 36.7897, lng: 126.4513, type: 'traffic', status: 'active' },
  { name: '영동고속도로 횡성IC', lat: 37.4885, lng: 127.9861, type: 'traffic', status: 'active' },
  { name: '남해고속도로 진주JC', lat: 35.1624, lng: 128.0712, type: 'traffic', status: 'active' },
  { name: '호남고속도로 논산JC', lat: 36.1870, lng: 127.0983, type: 'traffic', status: 'active' },
];

export function getCCTVGeoJSON(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: CCTV_RAW.map((c, i) => ({
      type: 'Feature' as const,
      id: `cctv-${i}`,
      geometry: {
        type: 'Point' as const,
        coordinates: [c.lng, c.lat],
      },
      properties: {
        name: c.name,
        cctvType: c.type,
        status: c.status,
        streamUrl: c.streamUrl ?? null,
        icon: c.type === 'traffic' ? 'traffic-cam' : c.type === 'security' ? 'security-cam' : 'disaster-cam',
      },
    })),
  };
}
