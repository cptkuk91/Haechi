# Transit & Crowd (대중교통/군중) - 데이터 레이어 API 조사

> **도메인**: `transit` | **아이콘**: 🚋 | **색상**: `#8b5cf6`
> **현재 상태**: 더미 카테고리 (레이어 없음) → 실제 공공 데이터 연동 필요

---

## - [ ] 1. 서울시 실시간 도시데이터 - 인구 혼잡도 (추천 1순위)

프로젝트와 가장 잘 맞는 데이터. 서울 주요 120개 장소의 실시간 인구 혼잡도를 heatmap/marker로 표시 가능.

| 항목 | 내용 |
|------|------|
| **제공처** | 서울 열린데이터광장 |
| **API 이름** | 서울시 실시간 도시데이터 (citydata) |
| **데이터** | 실시간 인구 혼잡도 (여유/보통/약간 붐빔/붐빔), 인구 수 추정, 혼잡도 예측(AI 기반 향후 12시간) |
| **갱신 주기** | 5분 |
| **커버리지** | 서울시 주요 120개 장소 (광화문, 명동, 홍대, 강남역 등) |
| **API URL 형식** | `http://openapi.seoul.go.kr:8088/{KEY}/json/citydata_ppltn/1/5/{장소명}` |
| **인증** | 서울 열린데이터광장 인증키 발급 필요 (무료) |
| **일일 호출 제한** | 1,000건/일 (기본) |
| **응답 형식** | JSON / XML |
| **비고** | 한 번에 1개 장소만 호출 가능. 120개 장소 전체 조회 시 120번 호출 필요 |

**레이어 구현 아이디어**:
- `transit-crowd-density` (heatmap): 서울 주요 장소별 인구 혼잡도 히트맵
- `transit-crowd-markers` (marker): 장소별 혼잡 등급 마커 (여유/보통/약간붐빔/붐빔)

**참고 링크**:
- [서울시 실시간 도시데이터](https://data.seoul.go.kr/SeoulRtd/)
- [서울시 실시간 인구데이터 (OA-21778)](https://data.seoul.go.kr/dataList/OA-21778/A/1/datasetView.do)
- [공공데이터포털 - 실시간 도시데이터](https://www.data.go.kr/data/15146211/openapi.do)

---

## - [ ] 2. 서울시 지하철 실시간 열차 위치정보 (추천 2순위)

지하철 열차의 실시간 위치를 지도 위에 표시 가능. 시각적 효과 우수.

| 항목 | 내용 |
|------|------|
| **제공처** | 서울 열린데이터광장 (TOPIS) |
| **API 이름** | 지하철 실시간 열차 위치정보 |
| **데이터셋 ID** | OA-12601 |
| **데이터** | 열차 현재 위치(역 사이), 호선, 열차번호, 상/하행, 급행 여부, 도착시각 |
| **API URL 형식** | `http://openapi.seoul.go.kr:8088/{KEY}/json/realtimePosition/0/100/{호선명}` |
| **호선명 예시** | `1호선`, `2호선`, ... `9호선`, `경의중앙선`, `신분당선` 등 |
| **인증** | 서울 열린데이터광장 인증키 (무료) |
| **일일 호출 제한** | 1,000건/일 |
| **응답 형식** | JSON / XML |
| **비고** | 호선별로 호출 필요. recptnDt(생성 시각)와 현재 시각 차이만큼 위치 보정 필요 |

**레이어 구현 아이디어**:
- `transit-subway-trains` (marker/icon): 호선별 열차 실시간 위치 (색상별 구분)

**참고 링크**:
- [서울시 지하철 실시간 열차 위치정보](https://data.seoul.go.kr/dataList/OA-12601/A/1/datasetView.do)
- [T-Data 서울교통빅데이터플랫폼](https://t-data.seoul.go.kr/dataprovide/trafficdataviewopenapi.do?data_id=10354)

---

## - [ ] 3. 서울시 지하철 실시간 도착정보 (추천 3순위)

역별 열차 도착 예정 시간 표시. StatusPanel에서 상세 정보 표시에 활용.

| 항목 | 내용 |
|------|------|
| **제공처** | 서울 열린데이터광장 |
| **API 이름** | 지하철 실시간 도착정보 |
| **데이터셋 ID** | OA-12764 (역별) / OA-15799 (일괄) |
| **데이터** | 역명, 호선, 도착예정시간, 현재 위치, 열차 종류, 행선지, 혼잡도 |
| **API URL 형식** | `http://swopenapi.seoul.go.kr/api/subway/{KEY}/json/realtimeStationArrival/0/5/{역명}` |
| **인증** | 서울 열린데이터광장 인증키 (무료) |
| **일일 호출 제한** | 1,000건/일 |
| **응답 형식** | JSON / XML |

**레이어 구현 아이디어**:
- 마커 클릭 시 StatusPanel에서 해당 역의 도착 예정 열차 정보 표시

**참고 링크**:
- [서울시 지하철 실시간 도착정보](https://data.seoul.go.kr/dataList/OA-12764/F/1/datasetView.do)
- [공공데이터포털 - 지하철 실시간 도착정보](https://www.data.go.kr/data/15058052/openapi.do)

---

## - [ ] 4. 서울시 버스 실시간 위치정보

서울 시내버스의 실시간 위치. 노선별 조회.

| 항목 | 내용 |
|------|------|
| **제공처** | 서울시 버스운행정보 공유서비스 (TOPIS) |
| **API 이름** | 노선별 버스 위치정보 조회 |
| **데이터** | 버스 현재 위치(위경도), 정류소 도착 여부, 차량번호, 차량유형, 혼잡도 |
| **API URL 형식** | `http://ws.bus.go.kr/api/rest/buspos/getBusPosByRtid?serviceKey={KEY}&busRouteId={노선ID}` |
| **인증** | 공공데이터포털 인증키 (무료) |
| **응답 형식** | XML |
| **비고** | 노선 ID별 개별 호출 필요. 전체 노선 표시에는 대량 호출 필요하여 특정 주요 노선만 표시 권장 |

**레이어 구현 아이디어**:
- `transit-bus-locations` (marker): 주요 노선 버스 실시간 위치 (전체 노선은 호출량 과다)

**참고 링크**:
- [서울특별시_버스위치정보조회 서비스](https://www.data.go.kr/data/15000332/openapi.do)
- [서울시 버스운행정보 Open API](http://api.bus.go.kr/)

---

## - [ ] 5. 국토교통부 TAGO 전국 버스 위치정보

서울 외 전국 시내버스 실시간 위치 조회.

| 항목 | 내용 |
|------|------|
| **제공처** | 국토교통부 (공공데이터포털) |
| **API 이름** | (TAGO) 버스위치정보 |
| **데이터** | 노선별 버스 위치(위경도), 차량번호, 노선유형 |
| **API URL 형식** | `http://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList?serviceKey={KEY}&cityCode={도시코드}&routeId={노선ID}` |
| **인증** | 공공데이터포털 인증키 (무료, 자동승인) |
| **호출 제한** | 개발: 10,000건/일 |
| **응답 형식** | XML / JSON |

**참고 링크**:
- [국토교통부_(TAGO)_버스위치정보](https://www.data.go.kr/data/15098533/openapi.do)
- [TAGO 오픈API](https://tago.go.kr/v5/use/openapi.jsp)

---

## - [ ] 6. SK Open API - 지하철 칸별 혼잡도 (유료/제한적)

지하철 칸별 혼잡도를 제공하지만 유료 API.

| 항목 | 내용 |
|------|------|
| **제공처** | SK Open API (T Map) |
| **API 이름** | 진입 역 기준 칸/열차 혼잡도 |
| **데이터** | 칸별 혼잡도, 하차 비율 |
| **API URL 형식** | `https://apis.openapi.sk.com/transit/puzzle/subway/congestion/stat/car?routeNm={노선명}&stationNm={역명}` |
| **인증** | SK Open API appKey 필요 |
| **운영 시간** | 05:30 ~ 23:50 (10분 간격 데이터) |
| **비고** | 상용 API (무료 티어 제한 있음). 프로젝트 요건에 따라 선택적 활용 |

**참고 링크**:
- [SK Open API - 실시간 열차/칸 혼잡도](https://openapi.sk.com/products/detail?svcSeq=54)
- [TMAP 대중교통 - 칸 혼잡도](https://transit.tmapmobility.com/docs/puzzle/car)

---

## - [ ] 7. KRIC 철도 데이터 포털

전국 철도(KTX, 일반열차) 관련 데이터.

| 항목 | 내용 |
|------|------|
| **제공처** | 한국철도공사 (KRIC) |
| **데이터** | 전국 철도역 위치, 노선 정보, 시간표 등 |
| **포털** | https://data.kric.go.kr |
| **비고** | 실시간 열차 위치 API는 제한적. 역 위치 + 시간표 기반 추정 표시는 가능 |

**참고 링크**:
- [KRIC 철도 데이터 포털](https://data.kric.go.kr/)

---

## 구현 우선순위 권장

| 순위 | 레이어 | API | 구현 난이도 | 시각적 효과 | 비고 |
|------|--------|-----|------------|------------|------|
| 1 | **인구 혼잡도 히트맵** | 서울시 실시간 도시데이터 | 중 | 높음 | 120개 장소 heatmap, 군중 모니터링에 최적 |
| 2 | **지하철 열차 위치** | 서울시 지하철 실시간 위치 | 중 | 높음 | 호선별 색상 구분, 움직이는 마커 |
| 3 | **지하철 도착 정보** | 서울시 지하철 실시간 도착 | 낮음 | 중 | StatusPanel 상세 정보로 활용 |
| 4 | **버스 위치** | 서울시 버스 위치정보 | 높음 | 중 | 노선별 호출 필요, 대량 데이터 |

---

## 환경 변수 계획

```env
# 서울 열린데이터광장 인증키 (실시간 도시데이터 + 지하철 위치/도착 공용)
TEAM2_SEOUL_OPENDATA_API_KEY=

# 서울시 버스 API (별도 인증키 필요 시)
TEAM2_SEOUL_BUS_API_KEY=

# 국토교통부 TAGO 버스 API (전국)
TEAM2_TAGO_BUS_API_KEY=
```

---

## API Route 구조 계획

```
app/api/transit/
  crowd-density/route.ts    → 서울시 실시간 인구 혼잡도
  subway-position/route.ts  → 지하철 실시간 열차 위치
  subway-arrival/route.ts   → 지하철 실시간 도착정보
  bus-location/route.ts     → 버스 실시간 위치 (선택)
```

---

## 주의사항

1. **호출 제한**: 서울 열린데이터광장 기본 1,000건/일. 120개 장소 x 폴링 간격 고려 필요
2. **인구 데이터**: 통신사 기지국 기반 추정치이므로 절대적 수치가 아닌 혼잡 등급으로 활용 권장
3. **지하철 위치 보정**: `recptnDt`(생성 시각)와 현재 시각 차이만큼 열차 위치 보정 로직 필요
4. **버스 API**: 노선별 개별 호출이므로 전체 표시는 비현실적. 주요 노선 선별 또는 혼잡도 데이터만 활용
5. **기존 패턴 준수**: `usePublicAPI` 훅 + `Team2LayerBootstrap` 패턴에 맞춰 `useTransitData()` 구현
