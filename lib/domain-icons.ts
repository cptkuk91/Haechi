// 도메인별 lucide-react 아이콘 매핑 — 양팀 공유
import {
  Plane, Video, Car, Shield, AlertTriangle, CloudSun,
  Anchor, Siren, TrainFront, HeartPulse, Zap, Lock, Accessibility,
  type LucideIcon,
} from 'lucide-react';
import type { DomainType } from '@/types/domain';

export const DOMAIN_ICONS: Record<DomainType, LucideIcon> = {
  aviation: Plane,
  cctv: Video,
  highway: Car,
  defense: Shield,
  disaster: AlertTriangle,
  weather: CloudSun,
  maritime: Anchor,
  crime: Siren,
  transit: TrainFront,
  health: HeartPulse,
  infra: Zap,
  cyber: Lock,
  vulnerable: Accessibility,
};
