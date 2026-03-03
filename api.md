# TENMO API Key Registry

많은 API 키를 관리하기 위한 기록 파일입니다.  
실제 키 값은 절대 이 파일에 직접 기록하지 않고, **환경변수 이름만** 기록합니다.

## 현재 사용 중

| 서비스 | 용도 | 상태 | 환경변수 | 비고 | 업데이트일 |
|---|---|---|---|---|---|
| 서울특별시_실시간 돌발 정보 (`AccInfo`) | 교통 돌발 실데이터 수집 (`traffic` 업스트림) | 사용 중 | `TEAM2_TRAFFIC_SEOUL_INCIDENT_API_KEY`, `TEAM2_TRAFFIC_UPSTREAM_URL` | URL 템플릿: `http://openapi.seoul.go.kr:8088/{KEY}/xml/AccInfo/1/200/` | 2026-03-03 |
| 국토교통부_비행금지구역 (`LT_C_AISPRHC`) | 항공/공역 관제 비행금지구역 실데이터 수집 (`no-fly-zones`) | 사용 중 | `TEAM2_DIGITAL_TWIN_API_KEY`, `TEAM2_DIGITAL_TWIN_API_DOMAIN` | VWorld Data API 2.0 `GetFeature` (`/api/aviation/no-fly`) | 2026-03-03 |
| 국토교통부_교통CCTV (`LT_P_UTISCCTV`) | 영상 보안 관제 CCTV 위치 실데이터 수집 (`cctv-markers`) | 사용 중 | `TEAM2_DIGITAL_TWIN_API_KEY`, `TEAM2_DIGITAL_TWIN_API_DOMAIN` | VWorld Data API 2.0 `GetFeature` (`/api/cctv/positions`) | 2026-03-03 |
| OpenSky 실시간 항공기 (`states/all`) | 항공기 라이브 트랙 연동 준비 | 대기 | `TEAM2_AVIATION_OPENSKY_CLIENT_ID`, `TEAM2_AVIATION_OPENSKY_CLIENT_SECRET` | OpenSky 가입/클라이언트 발급 서버 정상화 후 진행 (`/api/aviation/aircraft` 예정) | 2026-03-03 |

## 추가 규칙

1. 키 값은 `.env.local`에만 보관
2. 이 파일에는 키 값 대신 환경변수명만 기록
3. API 추가 시 위 표에 1행 추가하고 상태(`사용 중`/`대기`/`중단`) 갱신
