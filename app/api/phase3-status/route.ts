import { NextResponse } from 'next/server';
import { resolveDomainPayload, type Team2DomainRoute } from '@/app/api/_shared/domain-payload';

const PHASE3_REQUIRED_LAYER_IDS: Record<Team2DomainRoute, string[]> = {
  traffic: ['highway-bottleneck', 'highway-incidents', 'highway-reroute'],
  weather: ['weather-rainfall-column', 'weather-wind-particles', 'weather-rainfall-heat'],
  disaster: ['disaster-wildfire-points', 'disaster-earthquake-ripple'],
  infra: ['infra-grid-nodes'],
  crime: ['crime-risk-heatmap'],
  health: ['health-ambulance-route', 'health-er-capacity'],
  vulnerable: ['vulnerable-amber-radius', 'vulnerable-emergency-iot'],
};

export async function GET() {
  const domains = Object.keys(PHASE3_REQUIRED_LAYER_IDS) as Team2DomainRoute[];
  const resolutions = await Promise.all(domains.map((domain) => resolveDomainPayload(domain)));

  const domainStatus = domains.map((domain, index) => {
    const resolved = resolutions[index];
    const expectedLayers = PHASE3_REQUIRED_LAYER_IDS[domain];
    const existing = new Set(resolved.payload.layers.map((layer) => layer.id));
    const missing = expectedLayers.filter((id) => !existing.has(id));

    return {
      domain,
      source: resolved.source,
      layerCount: resolved.payload.layers.length,
      alertCount: resolved.payload.alerts.length,
      expectedLayers,
      missingLayers: missing,
      completed: missing.length === 0,
      warnings: resolved.warnings,
      ruleDiagnostics: resolved.ruleDiagnostics,
    };
  });

  const completedDomains = domainStatus.filter((item) => item.completed).length;
  const overall = {
    totalDomains: domainStatus.length,
    completedDomains,
    progressPercent: Math.round((completedDomains / domainStatus.length) * 100),
  };

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    phase: 'Phase 3',
    team: 'Team 2',
    overall,
    domains: domainStatus,
  });
}
