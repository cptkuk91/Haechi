# 공공 API 레이어 조사 및 작업 순서

검토 기준일: 2026-03-15

## 문서 목적

이 문서는 현재 프로젝트에 추가할 수 있는 공공 API를 단순 후보 목록으로 나열하는 문서가 아니다.
아래 3가지를 바로 판단할 수 있게 정리한다.

1. 어떤 방식으로 조사했는가
2. 어떤 기준으로 후보를 골랐는가
3. 실제 작업은 어떤 순서로 진행하는 것이 맞는가

## 1. 조사 방식

### 1-1. 외부 후보 조사

- Brave Search로 공공 API 후보를 먼저 찾음
- Perplexity Search로 같은 후보를 다시 교차 확인함
- 최종 판단은 각 기관의 공식 API 소개 페이지 기준으로 정리함

### 1-2. 프로젝트 내부 확인

- 현재 등록된 기본 레이어 구조 확인
- 현재 mock fallback, simulation, placeholder 상태 확인
- 어떤 후보가 기존 더미를 대체하는지, 어떤 후보가 빈 도메인을 채우는지 비교

### 1-3. 확인한 현재 코드 기준

- 기본 레이어 등록: `hooks/useDomainLayers.ts`
- 공용 mock fallback: `app/api/_shared/domain-payload.ts`
- 레이어 부트스트랩: `components/boot/LayerBootstrap.tsx`
- 항공 시뮬레이션 fallback: `hooks/useAircraftLayer.ts`
- 선박 시뮬레이션 코드: `hooks/useShipLayer.ts`

## 2. 선정 기준

후보 API는 아래 기준으로만 추렸다.

### 2-1. 현재 더미를 줄일 수 있는가

- 기존 mock layer를 그대로 실데이터로 교체할 수 있으면 최우선
- 비어 있는 도메인을 채울 수 있으면 그 다음 우선순위

### 2-2. 지도에 바로 올릴 수 있는가

- 위경도 point
- polygon 경계
- line 경로
- heatmap용 수치 데이터

이 중 하나로 바로 정규화 가능한 API만 우선 검토했다.

### 2-3. 현재 렌더링 구조와 맞는가

- `marker`
- `polygon`
- `line`
- `heatmap`
- `column`

현재 프로젝트가 이미 쓰는 레이어 타입에 자연스럽게 들어가는지를 봤다.

### 2-4. 구현 비용 대비 효과가 큰가

- 같은 레이어 ID를 유지하고 업스트림만 교체 가능한지
- 새 도메인 메뉴 체감 개선이 큰지
- WMS/WFS처럼 추가 정규화 작업이 필요한지

## 3. 현재 작업이 필요한 영역

### 3-1. 바로 교체 가능한 mock 대상

| 현재 상태 | 교체 후보 | 판단 |
| --- | --- | --- |
| `disaster-earthquake-ripple` mock | 기상청 지진정보 | 실데이터 교체 완료 |
| `weather-storm-zone` mock | 기상청 특보 | 가치 높지만 경계 매핑 작업이 필요함 |

### 3-2. 비어 있거나 체감이 약한 도메인

| 도메인 | 현재 상태 | 우선 후보 |
| --- | --- | --- |
| `crime` | 사실상 비어 있음 | 생활안전지도 안전비상벨 |
| `disaster` | 지진 실데이터 + 민방위대피시설 연동 완료 | 추가 대피소/피난 지원 레이어 검토 |
| `weather` | 대기질 측정소 + 대기질 열지도 연동 완료 | 다음 기상 실데이터 보강 후보 검토 |
| `infra` | 체감형 포인트 레이어 부족 | 전기자동차 충전소 |
| `maritime` | 해양 관측값 레이어 없음 | 해양기상부이·파고부이 |
| `vulnerable` | 계절성 보호 레이어 없음 | 한파쉼터 |

### 3-3. 이번 조사 후보로 직접 대체되지 않는 더미

| 레이어 | 상태 | 메모 |
| --- | --- | --- |
| `ship-ais-live`, `ship-trails` | 시뮬레이션 성격 | 이번 조사 후보 중 raw AIS 선박 점/항적 대체 소스는 확인 못함 |
| `aircraft-live`, `aircraft-trails` | OpenSky 없으면 fallback | 이번 조사 범위의 국내 공공 API로 바로 대체할 후보는 없음 |

## 4. 작업 진행 추천 순서

### 4-1. 1차 작업: mock 제거 또는 빈 도메인 해소

#### 1. `지진-진앙지-리플` [완료]

- 목적: 기존 mock `disaster-earthquake-ripple` 직접 교체
- 이유: 동일 레이어 자리를 유지할 수 있어 구현 비용이 가장 낮음
- 작업 형태: 기존 재난 route를 실제 지진 API 응답으로 교체
- 확보 위치: [공공데이터포털 `기상청_지진정보 조회서비스`](https://www.data.go.kr/data/15000420/openapi.do?recommendDataYn=Y)
- 진행 상태: 완료
- 완료 메모: `EqkInfoService/getEqkMsg` 기반 실데이터 연동 완료, `disaster-earthquake-ripple` 유지

#### 2. `안전-비상벨`

- 목적: 비어 있는 `crime` 도메인 첫 실데이터 레이어 추가
- 이유: 사용자 체감이 가장 큼
- 작업 형태: 좌표 기반 `marker`로 먼저 구현, WMS는 후순위
- 확보 위치: [생활안전지도 개발자센터 Data API](https://www.safemap.go.kr/dvct/data/selectDataAPIList.do), [오픈API 인증키 발급](https://www.safemap.go.kr/opna/crtfc/keyAgree.do)

#### 3. `민방위-대피시설` [완료]

- 목적: `disaster` 도메인에 실사용 대피 레이어 추가
- 이유: 지진, 산불, 폭우와 같이 볼 때 의미가 큼
- 작업 형태: `marker` + 상세 패널
- 확보 위치: [공공데이터포털 `행정안전부_민방위대피시설`](https://www.data.go.kr/data/15115459/openapi.do?recommendDataYn=Y)
- 진행 상태: 완료
- 완료 메모: `disaster-civil-defense-shelters` 레이어 추가, 실데이터 marker + 상세 패널 연동 완료

### 4-2. 2차 작업: 체감 가치가 높은 신규 레이어 확장

#### 4. `대기질-측정소` [완료]

- 목적: 측정소 위치 표시
- 이유: 대기오염값 heatmap만 있으면 설명력이 약함
- 확보 위치: [공공데이터포털 `한국환경공단_에어코리아_측정소정보`](https://www.data.go.kr/data/15073877/openapi.do)
- 진행 상태: 완료
- 완료 메모: `weather-air-quality-stations` 레이어 추가, 실데이터 marker + 상세 패널 + 로딩 토스트 연동 완료

#### 5. `대기질-열지도` [완료]

- 목적: PM10/PM2.5 기반 heatmap
- 이유: 날씨 도메인의 실데이터 체감 개선
- 확보 위치: [공공데이터포털 `한국환경공단_에어코리아_대기오염정보`](https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15073861)
- 진행 상태: 완료
- 완료 메모: `weather-air-quality-heatmap` 레이어 추가, 실데이터 heatmap + 로딩 토스트 + 상세 패널 연동 완료

#### 6. `전기차-충전소`

- 목적: `infra` 도메인 강화
- 이유: 사용자 체감이 높고 구현이 단순함
- 확보 위치: [공공데이터포털 `한국환경공단_전기자동차 충전소 정보`](https://www.data.go.kr/data/15076352/openapi.do)

#### 7. `한파-쉼터`

- 목적: `vulnerable` 도메인 계절성 보호 레이어 추가
- 이유: 기존 복지시설과 역할이 겹치지 않음
- 확보 위치: [공공데이터포털 `행정안전부_공유플랫폼_한파쉼터`](https://www.data.go.kr/data/15139703/openapi.do?recommendDataYn=Y), [재난안전데이터 공유플랫폼 상세](https://www.safetydata.go.kr/disaster-data/view?dataSn=966)

#### 8. `해양기상-부이`

- 목적: `maritime` 관측값 레이어 추가
- 이유: 기존 항만/정박지/항로표지와 다른 실시간 해양 관측 축을 제공함
- 확보 위치: [공공데이터포털 `기상청_해양기상관측자료 조회서비스`](https://www.data.go.kr/data/15043550/openapi.do)
- 비고: 공식 설명 기준 `방재기상업무 수행을 위해 공공기관에 한해서 제공` 문구가 있어 사전 접근 가능 여부 확인이 필요함

### 4-3. 3차 작업: geometry 또는 시계열 부담이 큰 레이어

#### 9. `기상-특보구역`

- 목적: 기존 mock `weather-storm-zone` 대체 또는 병행
- 이유: 효과는 크지만 특보구역 코드와 경계 매핑이 필요함
- 확보 위치: [공공데이터포털 `기상청_특보 조회서비스`](https://www.data.go.kr/data/15139476/openapi.do?recommendDataYn=Y), [공공데이터포털 `기상청_특보구역정보 조회서비스`](https://www.data.go.kr/data/15126651/openapi.do)
- 비고: 특보구역정보는 [기상청 API Hub 상세 페이지](https://apihub.kma.go.kr/apiList.do?seqApi=10&seqApiSub=288&apiMov=%ED%8A%B9.%EC%A0%95%EB%B3%B4%20%EC%9E%90%EB%A3%8C%20%EC%A1%B0%ED%9A%8C) 연결형으로 안내됨

#### 10. `태풍-경로`

- 목적: 태풍 중심점과 경로 시각화
- 이유: 시각 효과는 좋지만 시계열 처리까지 필요함
- 확보 위치: [공공데이터포털 `기상청_태풍정보 조회서비스`](https://www.data.go.kr/data/15043565/openapi.do)

#### 11. `행정구역-경계`

- 목적: 지원용 경계 소스 확보
- 이유: 직접 체감 기능보다 다른 통계형 레이어 지원용 성격이 강함
- 확보 위치: [공공데이터포털 `국토교통부_행정구역도(WMS/WFS)`](https://www.data.go.kr/data/15059008/openapi.do)

## 5. API별 연결 제안

| 순서 | API | 권장 레이어명 | 추천 도메인 | 신규/대체 | 확보 위치 | 구현 메모 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 기상청 지진정보 조회서비스 | `지진-진앙지-리플` | `disaster` | 기존 mock 대체 | [공공데이터포털](https://www.data.go.kr/data/15000420/openapi.do?recommendDataYn=Y) | 완료, 기존 `disaster-earthquake-ripple` 자리를 실데이터로 교체 |
| 2 | 생활안전지도 안전비상벨 | `안전-비상벨` | `crime` | 신규 추가 | [생활안전지도 개발자센터](https://www.safemap.go.kr/dvct/data/selectDataAPIList.do) / [인증키 발급](https://www.safemap.go.kr/opna/crtfc/keyAgree.do) | `crime` 도메인 첫 실사용 레이어 |
| 3 | 행정안전부 민방위대피시설 조회서비스 | `민방위-대피시설` | `disaster` | 신규 추가 | [공공데이터포털](https://www.data.go.kr/data/15115459/openapi.do?recommendDataYn=Y) | 완료, `disaster-civil-defense-shelters` 실데이터 marker + 상세 패널 연동 |
| 4 | 에어코리아 측정소정보 | `대기질-측정소` | `weather` | 신규 추가 | [공공데이터포털](https://www.data.go.kr/data/15073877/openapi.do) | 완료, `weather-air-quality-stations` 실데이터 marker + 상세 패널 연동 |
| 5 | 에어코리아 대기오염정보 | `대기질-열지도` | `weather` | 신규 추가 | [공공데이터포털](https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15073861) | 완료, `weather-air-quality-heatmap` 실데이터 heatmap + 로딩 토스트 연동 |
| 6 | 한국환경공단 전기자동차 충전소 정보 | `전기차-충전소` | `infra` | 신규 추가 | [공공데이터포털](https://www.data.go.kr/data/15076352/openapi.do) | 구현 난이도 낮음 |
| 7 | 행정안전부 공유플랫폼 한파쉼터 | `한파-쉼터` | `vulnerable` | 신규 추가 | [공공데이터포털](https://www.data.go.kr/data/15139703/openapi.do?recommendDataYn=Y) / [재난안전데이터 공유플랫폼](https://www.safetydata.go.kr/disaster-data/view?dataSn=966) | 계절성 보호 레이어 |
| 8 | 기상청 특보 조회서비스 | `기상-특보구역` | `weather` | 기존 mock 대체 또는 병행 | [특보 조회서비스](https://www.data.go.kr/data/15139476/openapi.do?recommendDataYn=Y) / [특보구역정보](https://www.data.go.kr/data/15126651/openapi.do) | 기존 `weather-storm-zone` 연계 검토 |
| 9 | 기상청 태풍정보 / 태풍정보(TD) | `태풍-경로` | `weather` | 신규 추가 | [공공데이터포털](https://www.data.go.kr/data/15043565/openapi.do) | point + line 조합 |
| 10 | 기상청 해양기상부이·파고부이 관측 조회서비스 | `해양기상-부이` | `maritime` | 신규 추가 | [공공데이터포털](https://www.data.go.kr/data/15043550/openapi.do) | 해양 관측값 marker, 공공기관 한정 여부 확인 필요 |
| 11 | 국토교통부 행정구역도(WMS/WFS) | `행정구역-경계` | `infra` 보조 | 지원용 | [공공데이터포털](https://www.data.go.kr/data/15059008/openapi.do) | 다른 통계형 레이어의 경계 소스로 사용 |

## 6. 실제 착수 시 작업 원칙

### 6-1. 먼저 할 일

- 기존 mock을 바로 교체할 수 있는 레이어부터 진행
- `marker` 기반 API부터 우선 구현
- 새 레이어를 만들 때는 UI 이름과 실제 코드 ID를 분리해 관리

### 6-2. 나중에 할 일

- WMS/WFS 기반 레이어
- 구역 코드와 행정경계 join이 필요한 레이어
- 시계열 path 애니메이션이 필요한 레이어

### 6-3. 지금 기준 권장 착수 묶음

1. `지진-진앙지-리플`
2. `안전-비상벨`
3. `민방위-대피시설`
4. `대기질-측정소`
5. `대기질-열지도`

이 5개가 현재 구조에서 효과 대비 비용이 가장 좋다.
