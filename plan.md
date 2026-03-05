# TENMO Data Layer 실행 계획 보고서

작성일: 2026-03-04 (KST)

## 1) 분석 범위

본 보고서는 아래 3개 내부 문서를 기준으로 Data Layer를 점검했다.

- `api.md`: 키 발급/상태 레지스트리
- `report.md`: 아키텍처/현재 구현/남은 작업
- `service.md`: 사회적 약자 도메인 API 우선순위

추가로 Brave Search + Perplexity를 통해 공식 문서/공공데이터 페이지를 교차 확인했다.

## 2) 현재 Data Layer 진단 (As-Is)

### 2-1. 구조 요약

현재 데이터 계층은 다음 2개 축으로 동작한다.

- 공통 도메인 파이프라인: `/api/[domain]` -> `resolveDomainPayload()` -> (upstream 실패 시) mock fallback
- 실데이터 보강 파이프라인: 개별 엔드포인트(`/api/disaster/wildfire-locations`, `/api/health/emergency-rooms`, `/api/vulnerable/missing-locations`, `/api/cctv/*`, `/api/aviation/*`)를 통해 특정 레이어를 overwrite

즉, "공통 BFF + 도메인별 보강 API"가 공존하는 구조다.

### 2-2. 도메인별 상태

| 영역 | 현재 상태 | 핵심 공백 |
|---|---|---|
| Traffic | 서울 돌발 XML 정규화/경보 룰까지 구현 | 서울 외 확장, 표준 스키마 버전 관리 미흡 |
| Weather | 공통 `/api/weather` 경유(주로 mock) | 실측 업스트림 연결/정규화 규격 부재 |
| Disaster | 산불 위치 실데이터 엔드포인트 구현 | 좌표 매칭 실패율 관리, 품질 지표 부재 |
| Health | 응급의료기관 실데이터 엔드포인트 구현 | endpoint 다양화/병상 실시간 지표 통합 필요 |
| Vulnerable | Safe182 + 좌표 매칭 구현 | `service.md`의 복지시설 API 미연결 |
| CCTV | 위치 + 스트림(UTIC) 경로 구현 | 운영키 승인/실재생 안정성/No-signal 운영정책 |
| Aviation | No-fly(VWorld), OpenSky OAuth 구현 | 쿼터 관리, 장애시 다운샘플/백오프 정책 강화 |
| Infra/Crime | 공통 도메인 경유(주로 mock) | 업스트림 실데이터 소스 연동 미완료 |

### 2-3. 핵심 리스크

- 코드 준비도와 키/승인 준비도가 분리되어 있어 운영 판단이 어렵다.
- 공통 파이프라인과 보강 파이프라인이 병행되어 동기화 복잡도가 높다.
- 일부 데이터 품질(주소 -> 좌표 매칭 성공률) 관리 지표가 없다.
- 불필요 파일/중복 라우트 정리가 아직 안 되어 유지보수 비용이 증가한다.

## 3) 앞으로 반드시 추가해야 할 내용 (Must Add)

### 3-1. 데이터 계약(Data Contract) 고정

1. `PublicAPIResponse` 및 각 특화 API 응답에 `schemaVersion` 추가
2. Zod(또는 동급) 기반 런타임 검증 추가
3. 공통 에러 코드 체계 통일 (`UPSTREAM_TIMEOUT`, `UPSTREAM_SCHEMA_MISMATCH`, `KEY_MISSING` 등)

### 3-2. 캐시/폴링 정책 일원화

1. 도메인별 `staleTime/refetchInterval/retry`를 중앙 정책 파일로 통합
2. 저변동 데이터(시설/공역/CCTV 위치)는 서버 캐시 + 태그 재검증 구조로 전환 검토
3. 고변동 데이터(OpenSky, 교통 돌발)는 현재 no-store + 짧은 polling 유지

### 3-3. 관측성(Observability) 추가

1. 엔드포인트별 성공률/지연/업스트림 비율(metric)
2. 경고 로그 구조화(domain, upstream, code, latency)
3. DataPipelineStatus를 "표시" 수준에서 "지표" 수준으로 확장

### 3-4. 데이터 품질 파이프라인 추가

1. 주소 파싱 성공률, 좌표 매칭 성공률 일별 집계
2. `dong_coordinates` 품질 점검 작업(결측/중복/행정구역 alias drift)
3. Geo 인덱스(2dsphere) 기준 정리 및 검증 스크립트 추가

## 4) 남은 작업 내용 (Backlog 확정)

### P0 (즉시 착수)

1. `service.md` 기준 사회복지시설 API(통합 시설정보) 1차 연동
2. Weather/Infra/Crime 실데이터 업스트림 연결(최소 1개 source씩)
3. Data Layer 상태표를 "코드준비/키준비/운영준비" 3축으로 분리
4. 공통/특화 API 응답 스키마 버전 도입

### P1 (다음 스프린트)

1. UTIC 스트림 후보선정/대체전략 고도화(재생 실패 자동 failover)
2. OpenSky 쿼터 대응(요청량 제한, bbox 전략, 429 처리 강화)
3. 산불/실종 좌표 매칭 정확도 개선(alias 룰/사전 확장)
4. 운영용 리포트 API(성공률, 경고 TOP N, fallback 비율)

### P2 (중기)

1. 경보 룰 엔진 외부 규칙화(JSON/DB 기반)
2. Webhook 기반 재검증(revalidateTag/revalidatePath) 운영 패턴 정착
3. 도메인별 업스트림 커넥터 모듈 분리(테스트 용이성 향상)

## 5) 추가하면 좋은 내용 (Nice to Have)

1. Query Key Factory 도입으로 키 오타/중복 방지
2. API 응답 ETag/If-None-Match 적용으로 트래픽 절감
3. 데이터 계층 Contract Test(스냅샷) 추가
4. 도메인별 Feature Flag로 업스트림 점진 활성화
5. 일시 장애 시 stale 캐시 반환 정책을 전 도메인으로 표준화

## 6) 불필요/정리 후보 (삭제/수정 권장)

1. `hooks/use-mobile.ts`: 현재 참조 없음(삭제 후보)
2. `app/api/traffic/route.ts`, `app/api/weather/route.ts`, `app/api/vulnerable/route.ts`:
   - 기능적으로 `/api/[domain]`과 중복
   - 유지 여부를 정책화(명시 라우트 유지 vs 동적 라우트 단일화)
3. 환경변수명 체계 정리:
   - 공통 도메인 키(`TEAM2_[DOMAIN]_UPSTREAM_URL`)와 특화 엔드포인트 키가 혼재
   - "공통/특화" 네이밍 표준 문서화 필요

## 7) 요일별 Phase 실행안 (2주)

### Week 1

- 월요일 (Phase 1): Data Contract 고정
  - 응답 스키마 버전, 공통 에러 코드, 검증 레이어 도입 설계
- 화요일 (Phase 2): 캐시/폴링 정책 통합
  - 도메인별 정책표 확정, 중앙 설정 파일 적용
- 수요일 (Phase 3): 실데이터 우선 연동
  - Weather/Infra/Crime 최소 업스트림 1개씩 연결
- 목요일 (Phase 4): 사회적 약자 API 확장
  - 사회복지시설 API 연동 + vulnerable-support-link 실제 데이터 반영
- 금요일 (Phase 5): 품질/관측성
  - 매칭 성공률, fallback 비율, 업스트림 성공률 대시보드화

### Week 2

- 월요일 (Phase 6): UTIC 스트림 안정화
  - 후보 전환 로직, 재시도/오류코드 정교화
- 화요일 (Phase 7): OpenSky 운영 튜닝
  - 429/backoff/요청량 보호장치, bbox 정책 보정
- 수요일 (Phase 8): 코드 정리
  - 미사용 파일 제거, 중복 라우트 정책 반영
- 목요일 (Phase 9): 테스트/회귀 검증
  - Contract test + 주요 API smoke test 자동화
- 금요일 (Phase 10): 운영 전환 점검
  - Runbook/장애 대응 문서/모니터링 임계치 확정

## 8) 완료 기준 (Definition of Done)

1. 도메인별 `source=upstream` 비율 목표치 설정 및 달성
2. fallback 발생률/좌표 매칭 실패율이 주간 기준으로 하향 안정화
3. 핵심 7개 도메인 응답 스키마 버전 일치
4. P0 항목 완료 후에도 UI 회귀(레이어/알림/상세패널) 없음

## 9) 참고 링크 (Brave + Perplexity 교차검증)

### 공식 문서

- Next.js Caching/Revalidation: https://nextjs.org/docs/app/guides/caching
- Next.js revalidatePath: https://nextjs.org/docs/app/api-reference/functions/revalidatePath
- Next.js revalidateTag: https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- TanStack Query Important Defaults(v5): https://tanstack.com/query/v5/docs/react/guides/important-defaults
- MongoDB 2dsphere: https://www.mongodb.com/docs/manual/core/indexes/index-types/geospatial/2dsphere/
- OpenSky REST API(OAuth2 포함): https://openskynetwork.github.io/opensky-api/rest.html

### 공공데이터/기관 페이지

- 국립중앙의료원 응급의료기관(15000563): https://www.data.go.kr/data/15000563/openapi.do
- 한국사회보장정보원 사회복지시설정보(15001848): https://www.data.go.kr/data/15001848/openapi.do
- UTIC 개방데이터 신청: https://www.utic.go.kr/guide/newUtisDataWrite.do
- 경찰청 교통 CCTV 영상 정보: https://www.data.go.kr/data/15148511/openapi.do

---

판단 메모:
- 위 권고안 중 일부(예: 캐시 계층 결합 방식, 라우트 단일화 우선순위)는 공식 문서를 바탕으로 현재 코드 구조에 맞춘 추론을 포함한다.
