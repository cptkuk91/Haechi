# TENMO - 3D 한국 통합 관제 시스템 프로젝트 리포트

## 1. 프로젝트 개요

- **목표**: 대한민국 전역의 다양한 안전/보안 요소를 실시간으로 모니터링하는 3D 웹 관제 애플리케이션
- **UI 컨셉**: 다크 모드 사이버 관제 스타일 (어두운 배경, 형광 포인트 컬러, CRT 스캔라인)

## 2. 기술 스택

| 영역 | 기술 |
|------|------|
| Framework | Next.js 14+ (App Router) |
| 3D Engine | Mapbox GL JS + Deck.gl |
| Styling | TailwindCSS + Framer Motion (motion/react) |
| State | Zustand (전역) + React Query (서버 상태) |
| Language | TypeScript |
| Data Format | GeoJSON 기반 통일 포맷 |

## 3. 환경변수 및 API 키

### 3-1. 필수 키 (실제값 필요)
| 변수 | 어디서 가져오나 | 메모 |
|------|------------------|------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | [Mapbox 계정 > Access tokens](https://account.mapbox.com/access-tokens/) | `pk.`로 시작하는 Public token 발급 후 `.env.local`에 설정 |
| `APP_URL` | 로컬: `http://localhost:3000`, 배포: Vercel/Cloud Run 배포 URL | OAuth callback, self-call 스크립트에서 사용 |
| `GEMINI_API_KEY` | [Google AI Studio API Keys](https://aistudio.google.com/app/apikey) | 현재 앱 로직에서는 직접 사용되지 않지만 런타임/확장 대비용 |

### 3-2. Team2 BFF 업스트림 키/URL (실제 연동 시)
업스트림 URL이 비어 있으면 `mock` 데이터가 자동 사용됩니다.

| 변수 | 실제값 가져오는 위치 | 메모 |
|------|------------------------|------|
| `TEAM2_PUBLIC_API_KEY` | [공공데이터포털(data.go.kr)](https://www.data.go.kr/)에서 OpenAPI 활용신청 후 발급받은 일반 인증키(서비스키) | 공통 키(도메인별 키 미설정 시 fallback) |
| `TEAM2_PUBLIC_API_KEY_PARAM` | 사용하려는 API 문서의 인증 파라미터명 확인 | 기본값 `serviceKey` |
| `TEAM2_UPSTREAM_TIMEOUT_MS` | 내부 운영 정책 값 | 기본 `8000` |
| `TEAM2_[DOMAIN]_UPSTREAM_URL` | 각 도메인에서 선택한 실제 OpenAPI endpoint | 예: `TEAM2_WEATHER_UPSTREAM_URL` |
| `TEAM2_[DOMAIN]_API_KEY` | 도메인별 API 제공기관 포털 (필요한 경우) | 설정 시 공통 키보다 우선 |

### 3-3. 도메인별 권장 키 발급처
| 도메인 | 권장 발급처 | 비고 |
|--------|-------------|------|
| `traffic` | 공공데이터포털(data.go.kr) - 국토교통/도로교통 계열 API | 교통량, 돌발상황, 소통정보 |
| `weather` | 공공데이터포털(data.go.kr) - 기상청 API | 단기예보/초단기실황 등 |
| `disaster` | 공공데이터포털(data.go.kr) - 행안부/산림청/재난 관련 API | 재난문자, 산불 등 |
| `infra` | 공공데이터포털(data.go.kr) - 전력/댐/상하수도 관련 기관 API | 인프라 부하/상태 데이터 |
| `crime` | 공공데이터포털(data.go.kr) - 경찰/치안 관련 API | 사건/위험지수 지표 |
| `health` | 공공데이터포털(data.go.kr) - 보건복지부/질병청/응급의료 API | 병상/응급의료/감염병 |
| `vulnerable` | 공공데이터포털(data.go.kr) - 복지/취약계층 관련 API | 복지시설/취약계층 지원 지표 |

### 3-4. 실제 키 세팅 순서
1. data.go.kr에서 도메인별 OpenAPI 활용신청 후 서비스키 발급
2. 각 API 문서에서 endpoint URL + 키 파라미터명(`serviceKey` 등) 확인
3. `.env.local`에 `TEAM2_[DOMAIN]_UPSTREAM_URL` / `TEAM2_[DOMAIN]_API_KEY` 또는 `TEAM2_PUBLIC_API_KEY` 입력
4. `/api/[domain]` 응답에서 `source: "upstream"`으로 전환되는지 확인
5. 실패 시 `DataPipelineStatus`와 서버 로그의 warning(`Missing upstream URL env`, `Upstream responded ...`) 확인

## 4. 프로젝트 파일 구조

```
tenmo/
├── app/
│   ├── layout.tsx              # 전역 레이아웃 (QueryClient, 폰트)
│   ├── page.tsx                # 메인 관제 화면 (HUD, 네비게이션)
│   ├── providers.tsx           # React Query Provider
│   ├── globals.css             # 글로벌 스타일
│   └── api/
│       ├── [domain]/route.ts   # BFF 프록시 (7개 도메인 공통)
│       ├── traffic/route.ts    # 교통 전용 엔드포인트
│       ├── weather/route.ts    # 기상 전용 엔드포인트
│       ├── vulnerable/route.ts # 사회적 약자 전용 엔드포인트
│       ├── phase3-status/route.ts # Phase3 상태 확인
│       └── _shared/
│           ├── domain-payload.ts      # 13개 도메인 Mock 데이터 (710줄)
│           ├── alert-rule-engine.ts   # 경보 룰 엔진 (10개 크로스도메인 체인)
│           ├── upstream-source.ts     # 업스트림 API 소스
│           └── upstream-normalizer.ts # 응답 정규화
├── components/
│   ├── map/
│   │   ├── MapCanvas.tsx       # Mapbox GL + Deck.gl 3D 지도
│   │   ├── HoloTooltip.tsx     # 홀로그램 툴팁
│   │   └── PIPPanel.tsx        # PIP 패널
│   ├── panels/
│   │   ├── LayerPanel.tsx      # 좌측 레이어 토글 패널
│   │   ├── StatusPanel.tsx     # 우측 상태/상세정보 패널
│   │   └── AlertDashboard.tsx  # 경보 대시보드 (History/Stats)
│   ├── alert/
│   │   ├── AlertEngine.tsx     # 토스트 경보 배너 엔진
│   │   ├── WarningOverlay.tsx  # Critical 경보 전체화면 오버레이
│   │   └── DataPipelineStatus.tsx # API 장애 HUD 표시
│   ├── data/
│   │   └── Team2LayerBootstrap.tsx # 2팀 공공데이터 → 레이어 자동 등록
│   ├── scenario/
│   │   └── ScenarioPlayer.tsx  # 시나리오 재생기 UI
│   └── ui/
│       ├── GlassCard.tsx       # 글래스모피즘 카드
│       ├── StatusBadge.tsx     # 상태 뱃지
│       ├── DataFeed.tsx        # 실시간 데이터 피드
│       └── MiniChart.tsx       # 미니 차트
├── hooks/
│   ├── usePublicAPI.ts         # React Query 기반 공공데이터 훅 (7개 도메인)
│   ├── useDomainLayers.ts      # 정적 도메인 레이어 등록
│   ├── useAircraftLayer.ts     # 항공기 실시간 시뮬레이션
│   ├── useShipLayer.ts         # 선박 AIS 시뮬레이션
│   ├── useTrainLayer.ts        # KTX/지하철 시뮬레이션
│   ├── useCyberDefenseLayer.ts # 사이버/국방 시뮬레이션
│   ├── useCrowdLayer.ts        # 군중 밀집도 시뮬레이션
│   ├── useTrafficFlowLayer.ts  # 고속도로 혼잡도 시뮬레이션
│   ├── useWeatherLayer.ts      # 기상/바람장 시뮬레이션
│   ├── useDisasterLayer.ts     # 재난/재해 시뮬레이션
│   ├── useHealthLayer.ts       # 보건/의료 시뮬레이션
│   ├── useVulnerableLayer.ts   # 사회적 약자 시뮬레이션
│   ├── useDispatchLayer.ts     # 112/119 출동 시뮬레이션
│   ├── useSelectedObjectBinding.ts # 객체 선택 바인딩
│   └── usePolling.ts           # 폴링 유틸
├── stores/
│   └── app-store.ts            # Zustand 중앙 스토어
├── types/
│   └── domain.ts               # 공유 타입 (13 DomainType, LayerConfig, Alert 등)
├── lib/
│   ├── domain-icons.ts         # 도메인별 아이콘 매핑
│   ├── layer-builder.ts        # 레이어 빌더 유틸
│   ├── scenario-engine.ts      # 시나리오 엔진 코어
│   ├── selected-object.ts      # 선택 객체 변환 헬퍼
│   ├── viewport-utils.ts       # 뷰포트 유틸
│   └── utils.ts                # 공통 유틸
├── data/
│   ├── cctv.ts                 # CCTV 정적 데이터
│   ├── defense.ts              # 국방 정적 데이터
│   ├── maritime.ts             # 해양 정적 데이터
│   └── transit.ts              # 대중교통 정적 데이터
├── styles/
│   └── theme.ts                # 디자인 토큰
├── workers/
│   └── geo-filter.worker.ts    # Web Worker 공간 필터링
└── 설정 파일
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── .env.local
    ├── .env.example
    └── .eslintrc.json
```

## 5. 공유 인터페이스 (types/domain.ts)

```typescript
type DomainType =
  | 'aviation' | 'cctv' | 'maritime' | 'transit' | 'defense' | 'cyber'
  | 'highway' | 'disaster' | 'weather' | 'crime' | 'health' | 'infra' | 'vulnerable';

type LayerType = 'marker' | 'polygon' | 'line' | 'heatmap' | 'particle' | 'arc' | 'column' | 'icon';

type AlertSeverity = 'info' | 'warning' | 'critical';

interface LayerConfig {
  id: string;
  domain: DomainType;
  name: string;
  type: LayerType;
  visible: boolean;
  data: GeoJSON.FeatureCollection;
  style: { color?; radius?; lineWidth?; opacity?; elevation?; animated? };
  onClick?: (feature: GeoJSON.Feature) => void;
}
```

## 6. UI/UX 아키텍처

- **단일 맵 다중 레이어 중첩**: 풀스크린 3D 지도 1개 + 도메인 레이어 On/Off
- **시점 이동 (Drill-down)**: 전국망(Macro) ↔ 마이크로(Micro) flyTo 애니메이션
- **HUD 상단 바**: 시스템 시계, 활성 경보 카운트, 도메인 수, 카메라 좌표
- **좌측 패널**: 13개 도메인별 레이어 토글 (아코디언)
- **우측 패널**: 선택 객체 상세 정보, 도메인 메트릭스
- **하단 네비게이션**: 8개 도시 바로가기 (Seoul, Busan, Incheon, Daegu, Daejeon, Gwangju, Ulsan, Jeju)
- **홀로그램 툴팁**: 3D 객체 hover 시 핵심 데이터 표시
- **PIP 패널**: CCTV 스트리밍 등 상세 정보 오버레이
- **CRT 스캔라인 + 비네트**: 관제 분위기 효과

## 7. 크로스 도메인 경보 체인 룰 (10개)

| # | 트리거 | 연계 경보 |
|---|--------|-----------|
| 1 | 기상 폭우 (강수량 ≥ 80mm) | → 도로 통행 제한 경고 (highway) |
| 2 | 기상 폭우 (강수량 ≥ 80mm) | → 대중교통 지연 경고 (transit) |
| 3 | 지진 (규모 ≥ 5.0) | → 산불 위험 증가 경고 (disaster) |
| 4 | 지진 (규모 ≥ 5.0) | → 댐/저수지 수위 점검 경고 (infra) |
| 5 | 대규모 교통사고 (사상자 ≥ 5) | → 구급차 출동 + 병상 확보 (health) |
| 6 | 교통 정체 (혼잡도 ≥ 90%) | → 구급차 우회 경로 안내 (health) |
| 7 | 인프라 전력 과부하 (≥ 85%) | → 사이버 공격 경계 강화 (cyber) |
| 8 | 치안 범죄 고위험 (가중치 ≥ 0.85) | → CCTV 모니터링 강화 (cctv) |
| 9 | 산불 확산 (면적 ≥ 10ha) | → 대피소 안내 (disaster) |
| 10 | 감염병 발생 (반경 2km) | → 의료기관 병상 경보 (health) |

도메인 내부 룰:
- **교통**: 돌발 사고 심각도 ≥ 4 → critical 경보
- **기상**: 태풍 접근 시 critical, 강풍/폭우 시 warning
- **재난**: 지진 규모 ≥ 5.0 → critical, 산불 확산 → warning
- **인프라**: 전력 부하 ≥ 85% → warning
- **치안**: 범죄 위험 가중치 ≥ 0.85 → warning

## 8. 시나리오 프리셋 (4종)

| 시나리오 | 설명 | 시퀀스 |
|---------|------|--------|
| 영토 침범 | KADIZ 접근 → 경보 → 요격 출격 | flyTo → toggleLayer(defense) → triggerAlert(critical) |
| 대규모 교통사고 | 사고 발생 → 구급차 출동 → 병원 연결 | flyTo → toggleLayer(highway) → triggerAlert → toggleLayer(health) |
| 사이버 공격 | DDoS 시작 → 공격 빔 → 방어 | flyTo → toggleLayer(cyber) → triggerAlert(critical) |
| 복합 재난 | 지진 → 산불 → 대피 → 구급차 | flyTo → triggerAlert → toggleLayer(disaster) → toggleLayer(health) |

## 9. 성능 최적화 상세

### LOD (Level of Detail) 4단계
| 레벨 | 줌 범위 | 최대 피처 | 스타일 스케일 |
|------|---------|-----------|-------------|
| LOD 0 | ≤ 7 | 200 | 0.5× |
| LOD 1 | 7~10 | 500 | 0.75× |
| LOD 2 | 10~13 | 2000 | 1.0× |
| LOD 3 | > 13 | 5000 | 1.25× |

### 최적화 기법
- **RAF 스로틀링**: requestAnimationFrame + 50ms 최소 간격으로 deck.gl 업데이트
- **Web Worker**: geo-filter.worker.ts에서 GeoJSON 공간 필터링 오프스레드 처리
- **React Query 캐싱**: 도메인별 차등 staleTime (교통 30초 ~ 기상 5분)
- **Exponential Backoff**: API 재시도 3회 (1→2→4초)
- **GC Time 연장**: 10분 (장애 시 캐시 데이터 보존)
- **placeholderData**: 마지막 성공 데이터 유지 (graceful degradation)

## 10. 남은 작업 (향후 개선)

### 높은 우선순위
- [ ] **실제 공공데이터 API 연동**: 현재 Mock 데이터 → 실제 API 키 설정 후 업스트림 URL 연결
- [ ] **CCTV 실시간 스트리밍**: ITS HLS 스트리밍 URL 연결 (PIP 패널에서 재생)
- [ ] **OpenSky Network 연동**: 항공기 실시간 위치 데이터 (현재 시뮬레이션)

### 중간 우선순위
- [ ] CCTV 시야각(FOV) 시각화 및 사각지대 분석
- [ ] 우회 경로 시뮬레이션 (경로 계산 로직)
- [ ] 감염병 확산 시나리오 고도화
- [ ] 소음 등고선 레이어
- [ ] 공항 이착륙 스케줄 타임라인

### 낮은 우선순위
- [ ] 레이어 드래그 순서 변경
- [ ] 다중 PIP 스택 관리 (최대 3개)
- [ ] 사운드 알림 (등급별 차등)
- [ ] Storybook UI 컴포넌트 개발
- [ ] E2E 테스트 (Playwright)
- [ ] WebSocket 전환 (실시간성 높은 도메인)

## 11. 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npx next build

# 빌드 후 실행
npx next start
```

**최소 요구사항**: `NEXT_PUBLIC_MAPBOX_TOKEN`이 `.env.local`에 설정되어 있어야 합니다.
업스트림 API 미설정 시 모든 도메인은 자동으로 Mock 데이터를 사용합니다.
