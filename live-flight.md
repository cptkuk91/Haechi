# Live Flight (OpenSky) 연동 메모

## 1) 현재 상태 (2026-03-03)
- OpenSky Network 회원가입/로그인 서버 이슈로 계정 생성 진행 불가.
- 따라서 실시간 항공기 데이터(OpenSky) 연동은 보류 상태.
- 현재 지도의 항공기 표시는 기존 시뮬레이션(mock) 레이어를 사용.

## 2) OpenSky 복구 후 진행 순서
1. OpenSky 계정 생성 및 로그인
2. API Client 발급 (`client_id`, `client_secret`)
3. 서버에서 OAuth2 토큰 발급 후 OpenSky REST 호출
4. 응답 `states/all` 데이터를 우리 항공기 레이어 포맷으로 매핑
5. 지도에서 항공기 아이콘 + 방위(`true_track`) 회전 적용

## 3) 환경변수 제안
- `TEAM2_AVIATION_OPENSKY_CLIENT_ID`
- `TEAM2_AVIATION_OPENSKY_CLIENT_SECRET`
- `TEAM2_AVIATION_OPENSKY_BBOX` (예: `33,124,39,132`)
- `TEAM2_AVIATION_OPENSKY_POLL_MS` (예: `15000`)

## 4) 호출 기준(초안)
- Token URL  
  `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
- Flight State URL  
  `https://opensky-network.org/api/states/all?lamin=33&lomin=124&lamax=39&lomax=132`

## 5) 참고
- 비상업/연구 목적 사용 정책, rate limit, 인증 정책은 OpenSky 공식 문서 기준으로 최종 확인 필요.
- 서버 이슈 해소 전까지는 키 발급 및 실제 연동 검증 불가.
