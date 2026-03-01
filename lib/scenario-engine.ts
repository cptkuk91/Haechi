// 시나리오 스크립트 엔진 — JSON 기반 타임라인 이벤트 재생
// store 액션(flyTo, toggleLayer, triggerAlert, selectObject)을 시간순으로 실행

import type { AlertSeverity, DomainType } from '@/types/domain';

// ── 시나리오 이벤트 타입 ──

export type ScenarioEvent =
  | { t: number; action: 'flyTo'; params: { lat: number; lng: number; zoom: number } }
  | { t: number; action: 'toggleLayer'; params: { id: string; visible: boolean } }
  | { t: number; action: 'triggerAlert'; params: { severity: AlertSeverity; domain: DomainType; title: string; message: string; coordinates?: [number, number] } }
  | { t: number; action: 'selectObject'; params: { id: string; domain: DomainType; type: string; coordinates: [number, number]; properties: Record<string, unknown> } }
  | { t: number; action: 'wait'; params: { duration: number } };

export interface Scenario {
  id: string;
  name: string;
  nameKo: string;
  description: string;
  duration: number; // ms
  events: ScenarioEvent[];
}

// ── 엔진 상태 ──

export type EngineState = 'idle' | 'playing' | 'paused';

export interface ScenarioEngineCallbacks {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  toggleLayer: (id: string) => void;
  triggerAlert: (alert: { severity: AlertSeverity; domain: DomainType; title: string; message: string; coordinates?: [number, number] }) => void;
  selectObject: (obj: { id: string; domain: DomainType; type: string; coordinates: [number, number]; properties: Record<string, unknown> }) => void;
  addLayer: (layer: any) => void;
}

export class ScenarioEngine {
  private scenario: Scenario | null = null;
  private callbacks: ScenarioEngineCallbacks;
  private state: EngineState = 'idle';
  private startTime = 0;
  private pausedAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private onStateChange?: (state: EngineState, progress: number) => void;

  constructor(callbacks: ScenarioEngineCallbacks) {
    this.callbacks = callbacks;
  }

  setOnStateChange(fn: (state: EngineState, progress: number) => void) {
    this.onStateChange = fn;
  }

  getState(): EngineState {
    return this.state;
  }

  getProgress(): number {
    if (!this.scenario) return 0;
    if (this.state === 'idle') return 0;
    if (this.state === 'paused') return this.pausedAt / this.scenario.duration;
    return Math.min(1, (Date.now() - this.startTime) / this.scenario.duration);
  }

  play(scenario: Scenario) {
    this.stop();
    this.scenario = scenario;
    this.startTime = Date.now();
    this.state = 'playing';
    this.scheduleEvents(0);
    this.onStateChange?.('playing', 0);
  }

  pause() {
    if (this.state !== 'playing' || !this.scenario) return;
    this.pausedAt = Date.now() - this.startTime;
    this.clearTimers();
    this.state = 'paused';
    this.onStateChange?.('paused', this.pausedAt / this.scenario.duration);
  }

  resume() {
    if (this.state !== 'paused' || !this.scenario) return;
    this.startTime = Date.now() - this.pausedAt;
    this.state = 'playing';
    this.scheduleEvents(this.pausedAt);
    this.onStateChange?.('playing', this.pausedAt / this.scenario.duration);
  }

  stop() {
    this.clearTimers();
    this.state = 'idle';
    this.scenario = null;
    this.pausedAt = 0;
    this.onStateChange?.('idle', 0);
  }

  private clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private scheduleEvents(fromMs: number) {
    if (!this.scenario) return;

    const events = this.scenario.events.filter((e) => e.t >= fromMs);

    for (const event of events) {
      const delay = event.t - fromMs;
      const timer = setTimeout(() => {
        if (this.state !== 'playing') return;
        this.executeEvent(event);
      }, delay);
      this.timers.push(timer);
    }

    // 시나리오 종료 타이머
    const endDelay = this.scenario.duration - fromMs;
    const endTimer = setTimeout(() => {
      if (this.state === 'playing') {
        this.state = 'idle';
        this.onStateChange?.('idle', 1);
      }
    }, endDelay);
    this.timers.push(endTimer);
  }

  private executeEvent(event: ScenarioEvent) {
    switch (event.action) {
      case 'flyTo':
        this.callbacks.flyTo(event.params.lat, event.params.lng, event.params.zoom);
        break;
      case 'toggleLayer':
        this.callbacks.toggleLayer(event.params.id);
        break;
      case 'triggerAlert':
        this.callbacks.triggerAlert(event.params);
        break;
      case 'selectObject':
        this.callbacks.selectObject(event.params);
        break;
      case 'wait':
        // no-op, just a timing marker
        break;
    }
  }
}

// ── 프리셋 시나리오 ──

export const PRESET_SCENARIOS: Scenario[] = [
  {
    id: 'territorial-invasion',
    name: 'Territorial Invasion',
    nameKo: '영토 침범 시나리오',
    description: 'KADIZ 접근 → 경보 → 요격 출격 → 경로 추적',
    duration: 35000,
    events: [
      { t: 0, action: 'flyTo', params: { lat: 37.5, lng: 126.5, zoom: 7 } },
      { t: 1000, action: 'toggleLayer', params: { id: 'kadiz-boundary', visible: true } },
      { t: 1500, action: 'toggleLayer', params: { id: 'mdl-boundary', visible: true } },
      { t: 3000, action: 'toggleLayer', params: { id: 'defense-intrusion', visible: true } },
      { t: 5000, action: 'triggerAlert', params: { severity: 'warning', domain: 'defense', title: 'KADIZ 접근 탐지', message: '미확인 항공기 KADIZ 외곽 접근 중. 방공 레이더 추적 개시.', coordinates: [125.5, 37.9] } },
      { t: 7000, action: 'flyTo', params: { lat: 37.9, lng: 125.5, zoom: 8 } },
      { t: 10000, action: 'triggerAlert', params: { severity: 'critical', domain: 'defense', title: 'KADIZ 침범', message: '미확인 항공기 KADIZ 진입 확인! 요격기 출격 명령 하달.', coordinates: [126.0, 37.8] } },
      { t: 13000, action: 'toggleLayer', params: { id: 'aircraft-live', visible: true } },
      { t: 13000, action: 'toggleLayer', params: { id: 'aircraft-trails', visible: true } },
      { t: 15000, action: 'flyTo', params: { lat: 37.8, lng: 126.0, zoom: 9 } },
      { t: 18000, action: 'triggerAlert', params: { severity: 'info', domain: 'defense', title: '요격기 접근', message: 'KF-16 편대 미확인 항공기 인터셉트 진행 중.', coordinates: [126.3, 37.7] } },
      { t: 23000, action: 'triggerAlert', params: { severity: 'info', domain: 'defense', title: '침입기 퇴각', message: '미확인 항공기 KADIZ 밖으로 이탈. 요격 편대 귀환 중.', coordinates: [125.0, 38.0] } },
      { t: 26000, action: 'flyTo', params: { lat: 36.5, lng: 127.5, zoom: 7 } },
      { t: 30000, action: 'toggleLayer', params: { id: 'defense-intrusion', visible: false } },
      { t: 32000, action: 'triggerAlert', params: { severity: 'info', domain: 'defense', title: '상황 종료', message: 'KADIZ 침범 대응 완료. 경계 태세 유지.' } },
    ],
  },
  {
    id: 'cyber-attack',
    name: 'Cyber Attack',
    nameKo: '사이버 공격 시나리오',
    description: 'DDoS 시작 → 공격 빔 → 통신 장애 → 방어',
    duration: 30000,
    events: [
      { t: 0, action: 'flyTo', params: { lat: 37.5, lng: 127.0, zoom: 8 } },
      { t: 2000, action: 'toggleLayer', params: { id: 'cyber-attacks', visible: true } },
      { t: 3000, action: 'triggerAlert', params: { severity: 'warning', domain: 'cyber', title: 'DDoS 트래픽 감지', message: '중국발 대규모 DDoS 트래픽 유입 감지. 서울 정부청사 타겟.', coordinates: [126.98, 37.57] } },
      { t: 6000, action: 'triggerAlert', params: { severity: 'critical', domain: 'cyber', title: '통신망 과부하', message: '서울 정부통합센터 통신 과부하! 방어 체계 가동.', coordinates: [126.98, 37.57] } },
      { t: 8000, action: 'flyTo', params: { lat: 37.57, lng: 126.98, zoom: 12 } },
      { t: 12000, action: 'triggerAlert', params: { severity: 'warning', domain: 'cyber', title: '2차 공격 감지', message: '러시아발 악성코드 대전 정부통합센터 침투 시도.', coordinates: [127.44, 36.33] } },
      { t: 15000, action: 'flyTo', params: { lat: 36.33, lng: 127.44, zoom: 10 } },
      { t: 19000, action: 'triggerAlert', params: { severity: 'info', domain: 'cyber', title: 'DDoS 차단 완료', message: '1차 DDoS 공격 차단 완료. 트래픽 정상화.', coordinates: [126.98, 37.57] } },
      { t: 23000, action: 'triggerAlert', params: { severity: 'info', domain: 'cyber', title: '악성코드 격리', message: '대전 센터 악성코드 격리 완료. 시스템 정상 복구.' } },
      { t: 26000, action: 'flyTo', params: { lat: 36.5, lng: 127.5, zoom: 7 } },
    ],
  },
  {
    id: 'traffic-accident',
    name: 'Major Traffic Accident',
    nameKo: '대규모 교통사고 시나리오',
    description: '고속도로 사고 → 구급차 출동 → 병원 연결 → 우회 경로',
    duration: 32000,
    events: [
      { t: 0, action: 'flyTo', params: { lat: 36.8, lng: 127.2, zoom: 9 } },
      { t: 2000, action: 'triggerAlert', params: { severity: 'critical', domain: 'highway', title: '다중추돌 사고', message: '경부고속도로 천안 부근 10중 추돌사고 발생. 양방향 전면 통제.', coordinates: [127.11, 36.81] } },
      { t: 4000, action: 'flyTo', params: { lat: 36.81, lng: 127.11, zoom: 12 } },
      { t: 6000, action: 'toggleLayer', params: { id: 'ktx-routes', visible: true } },
      { t: 7000, action: 'triggerAlert', params: { severity: 'warning', domain: 'health', title: '구급차 출동', message: '천안 소방서 구급차 3대 출동. 현장 도착 예상 8분.', coordinates: [127.15, 36.80] } },
      { t: 10000, action: 'triggerAlert', params: { severity: 'warning', domain: 'highway', title: '우회 경로 안내', message: '일반국도 1호선 우회 권고. 예상 지연 1시간 30분.' } },
      { t: 14000, action: 'triggerAlert', params: { severity: 'info', domain: 'health', title: '환자 이송', message: '중상 3명 천안충남대병원 이송 중. 병상 확보 완료.', coordinates: [127.14, 36.82] } },
      { t: 18000, action: 'toggleLayer', params: { id: 'train-live', visible: true } },
      { t: 20000, action: 'triggerAlert', params: { severity: 'info', domain: 'transit', title: 'KTX 지연 안내', message: '경부선 KTX 천안아산역 일부 정차. 10~15분 지연.' } },
      { t: 24000, action: 'flyTo', params: { lat: 36.5, lng: 127.5, zoom: 7 } },
      { t: 28000, action: 'triggerAlert', params: { severity: 'info', domain: 'highway', title: '통제 해제', message: '사고 수습 완료. 편도 1차로 개방. 정상화 예상 2시간.' } },
    ],
  },
  {
    id: 'complex-disaster',
    name: 'Complex Disaster',
    nameKo: '복합 재난 시나리오',
    description: '지진 → 산불 → 대피 경로 → 구급차 출동',
    duration: 40000,
    events: [
      { t: 0, action: 'flyTo', params: { lat: 35.88, lng: 128.60, zoom: 9 } },
      { t: 2000, action: 'triggerAlert', params: { severity: 'critical', domain: 'disaster', title: '지진 발생', message: '경북 경주 인근 규모 5.8 지진 발생! 여진 주의.', coordinates: [129.21, 35.84] } },
      { t: 4000, action: 'flyTo', params: { lat: 35.84, lng: 129.21, zoom: 11 } },
      { t: 6000, action: 'toggleLayer', params: { id: 'no-fly-zones', visible: true } },
      { t: 7000, action: 'triggerAlert', params: { severity: 'warning', domain: 'disaster', title: '원전 안전 점검', message: '월성 원전 긴급 안전 점검 돌입. 현재 이상 없음.', coordinates: [129.47, 35.70] } },
      { t: 9000, action: 'flyTo', params: { lat: 35.70, lng: 129.47, zoom: 12 } },
      { t: 12000, action: 'triggerAlert', params: { severity: 'warning', domain: 'disaster', title: '산불 발생', message: '경주 토함산 지진 진동 여파 산불 발생. 소방 헬기 출동.', coordinates: [129.35, 35.79] } },
      { t: 15000, action: 'flyTo', params: { lat: 35.79, lng: 129.35, zoom: 11 } },
      { t: 17000, action: 'toggleLayer', params: { id: 'cctv-markers', visible: true } },
      { t: 19000, action: 'triggerAlert', params: { severity: 'warning', domain: 'health', title: '구급대 출동', message: '경주시 소방서 구급차 5대 + 포항 지원 2대 출동.', coordinates: [129.21, 35.84] } },
      { t: 22000, action: 'triggerAlert', params: { severity: 'info', domain: 'transit', title: '열차 운행 중단', message: '경부선 울산-포항 구간 열차 운행 임시 중단.' } },
      { t: 25000, action: 'triggerAlert', params: { severity: 'info', domain: 'disaster', title: '대피소 개방', message: '경주시 대피소 12개소 개방. 이재민 380명 수용.', coordinates: [129.21, 35.84] } },
      { t: 29000, action: 'flyTo', params: { lat: 35.84, lng: 129.21, zoom: 10 } },
      { t: 33000, action: 'triggerAlert', params: { severity: 'info', domain: 'disaster', title: '산불 진화', message: '토함산 산불 70% 진화. 잔불 정리 중.' } },
      { t: 36000, action: 'flyTo', params: { lat: 36.5, lng: 127.5, zoom: 7 } },
    ],
  },
];
