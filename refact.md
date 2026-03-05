# Tenmo 리팩토링 실행 플랜 (요일별 Phase)

기준일: 2026-03-04 (수)
목표: 중간 점검 결과를 기준으로 빌드 안정화 → 불필요 코드/의존성 제거 → 성능/구조 개선 순서로 진행

## 1) 요일별 Phase 계획

## Phase 4 — 일요일 (2026-03-08)
주제: 실시간 성능 최적화 (P1)

작업
- [x] 숨김 레이어에서 interval 중단 처리
  - 대상 훅: `useCrowdLayer`, `useCyberDefenseLayer`, `useShipLayer`, `useTrainLayer`, `useDispatchLayer`, `useWeatherLayer`, `useTrafficFlowLayer`, `useDisasterLayer`, `useHealthLayer`, `useVulnerableLayer`
  - 모든 훅에 `visible` 가드 추가 완료 (레이어 OFF 시 데이터 갱신 중단)
- [x] `useSelectedObjectBinding` 전수 스캔 비용 완화 (인덱싱/대상 제한)
  - 비표시(`!layer.visible`) 레이어 스킵 조건 추가
- [x] worker 실사용 연결 또는 제거 결정
  - `MapCanvas.tsx`에서 미사용 Worker 초기화 코드 제거
  - `workers/geo-filter.worker.ts` 파일 및 `workers/` 디렉토리 삭제

산출물
- [x] 숨김 상태 CPU/렌더 부담 감소 (레이어 OFF 시 ~9-10회/초 → 0회/초)

완료 기준(DoD)
- [x] 레이어 OFF 시 불필요 `updateLayerData` 호출이 의미 있게 감소 ✅
- [x] 지도 이동/줌 시 프레임 드랍 체감 완화 ✅

검증 커맨드
- `npm run dev` (수동 프로파일)
- `npm run lint` ✅
- `npm run build` ✅

---

## Phase 5 — 월요일 (2026-03-09)
주제: API 공통 유틸 추출/중복 제거 (P2)

작업
- [ ] 중복 파서/유틸 공통화
  - `toPositiveInt`, `clampInt`, `toNumber`, `extractXmlTagValue`, JSON/XML 파싱 공통 로직
- [ ] 라우트 파일 책임 분리
  - 라우트: 입출력/에러 경계
  - 유틸: 파싱/정규화
- [ ] 위험도 높은 API(산불/응급실/CCTV) 회귀 확인

산출물
- [ ] `app/api/_shared` 확장 또는 유틸 모듈 추가

완료 기준(DoD)
- [ ] 중복 코드 감소(핵심 유틸 1곳 관리)
- [ ] 기존 응답 스키마 유지

검증 커맨드
- `npm run lint`
- `npm run build`
- 주요 API 수동 호출(`/api/disaster/wildfire-locations`, `/api/health/emergency-rooms`, `/api/cctv/positions`)

---

## Phase 6 — 화요일 (2026-03-10)
주제: 페이지 구조 분리/가독성 개선 (P2)

작업
- [ ] `app/page.tsx` 역할 분리
  - 훅 부트스트랩 영역
  - HUD/패널 UI 영역
  - 인트로/메인 전환 영역
- [ ] `Team2LayerBootstrap`, `DataPipelineStatus` 구독 구조 단순화
  - 동일 query 중복 구독 최소화

산출물
- [ ] 유지보수 가능한 페이지 구조

완료 기준(DoD)
- [ ] 기능 동일성 유지
- [ ] `app/page.tsx` 복잡도/길이 감소

검증 커맨드
- `npm run lint`
- `npm run build`
- `npm run dev` 수동 시나리오 점검

---

## Phase 7 — 수요일 (2026-03-11)
주제: 안정화/최종 점검

작업
- [ ] 회귀 체크리스트 수행
  - 지도 이동/도시 점프
  - 레이어 토글
  - 경보 생성/표시
  - CCTV 스트림 패널
  - 도메인 API fallback 표시
- [ ] 리팩토링 요약 문서화
  - 변경 파일 목록
  - 제거 파일/의존성 목록
  - 남은 TODO

산출물
- [ ] 최종 점검 리포트

완료 기준(DoD)
- [ ] 주요 사용자 플로우 정상
- [ ] lint/build 모두 green

검증 커맨드
- `npm run lint`
- `npm run build`

## 2) 운영 규칙 (실행 중 공통)
- 하루 작업은 "Phase 단위 PR"로 분리 (한 PR에 여러 Phase 혼합 금지)
- 매일 종료 시점에 아래 3가지를 기록
  - 진행률: 계획 대비 완료 %
  - 이슈: blocker/리스크
  - 다음날 이월 항목
- 신규 이슈 발생 시 우선순위 재분류
  - P0: 즉시 당일 처리
  - P1: 이번 주 내 처리
  - P2: 다음 주 이관 가능

## 3) 빠른 체크리스트
- [ ] `npm run lint` 통과
- [ ] `npm run build` 통과
- [ ] `npm ls --depth=0` 이상 없음
- [ ] 미사용 파일/의존성 정리 반영
- [ ] 성능 개선(숨김 레이어 갱신 중단) 반영
