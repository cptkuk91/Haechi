import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_LAYER_IDS = {
  traffic: ['highway-bottleneck', 'highway-incidents', 'highway-reroute'],
  weather: ['weather-rainfall-column', 'weather-wind-particles', 'weather-rainfall-heat'],
  disaster: ['disaster-wildfire-points', 'disaster-earthquake-ripple'],
  infra: ['infra-grid-nodes'],
  crime: ['crime-risk-heatmap'],
  health: [],
  vulnerable: ['vulnerable-amber-radius', 'vulnerable-emergency-iot'],
};

const BASE = 'http://localhost:3120';
const CWD = process.cwd();

async function loadText(relativePath) {
  return readFile(path.join(CWD, relativePath), 'utf8');
}

function collectMissingLayerIds(sourceText, layerIds) {
  return layerIds.filter((id) => !sourceText.includes(`id: '${id}'`));
}

async function fetchDomainStatus(domain) {
  const response = await fetch(`${BASE}/api/${domain}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch /api/${domain}: ${response.status}`);
  }

  const payload = await response.json();
  const existing = new Set((payload.layers || []).map((layer) => layer.id));
  const missing = REQUIRED_LAYER_IDS[domain].filter((id) => !existing.has(id));

  return {
    domain,
    source: payload.source || 'unknown',
    generatedAlerts: payload.ruleDiagnostics?.generated ?? 0,
    chainedAlerts: payload.ruleDiagnostics?.chained ?? 0,
    totalAlerts: payload.ruleDiagnostics?.total ?? (payload.alerts?.length ?? 0),
    missingLayers: missing.join(', ') || '-',
    complete: missing.length === 0,
  };
}

async function runApiMode() {
  const domains = Object.keys(REQUIRED_LAYER_IDS);
  const rows = await Promise.all(domains.map((domain) => fetchDomainStatus(domain)));

  console.table(rows);

  const completeCount = rows.filter((row) => row.complete).length;
  const progress = Math.round((completeCount / rows.length) * 100);
  console.log(`Team2 Phase3 progress (API): ${completeCount}/${rows.length} domains (${progress}%)`);
}

async function runSourceMode() {
  const payloadSource = await loadText('app/api/_shared/domain-payload.ts');
  const appPageSource = await loadText('app/page.tsx');
  const trafficFlowSource = await loadText('hooks/useTrafficFlowLayer.ts');
  const weatherSource = await loadText('hooks/useWeatherLayer.ts');
  const disasterSource = await loadText('hooks/useDisasterLayer.ts');
  const vulnerableSource = await loadText('hooks/useVulnerableLayer.ts');
  const selectedBindingSource = await loadText('hooks/useSelectedObjectBinding.ts');

  const domainRows = Object.entries(REQUIRED_LAYER_IDS).map(([domain, ids]) => {
    const missing = collectMissingLayerIds(payloadSource, ids);
    return {
      domain,
      source: 'source-scan',
      missingLayers: missing.join(', ') || '-',
      complete: missing.length === 0,
    };
  });

  console.table(domainRows);

  const realtimeChecks = [
    {
      check: 'traffic-line-realtime',
      ok:
        trafficFlowSource.includes("highway-bottleneck") &&
        trafficFlowSource.includes("highway-incidents") &&
        trafficFlowSource.includes('setInterval'),
    },
    {
      check: 'selected-object-live-binding',
      ok:
        selectedBindingSource.includes('deriveFeatureObjectId') &&
        appPageSource.includes('useSelectedObjectBinding();'),
    },
    {
      check: 'traffic-hook-mounted',
      ok: appPageSource.includes('useTrafficFlowLayer();'),
    },
    {
      check: 'weather-hook-mounted',
      ok:
        appPageSource.includes('useWeatherLayer();') &&
        weatherSource.includes("weather-rainfall-column") &&
        weatherSource.includes("weather-wind-particles"),
    },
    {
      check: 'disaster-hook-mounted',
      ok:
        appPageSource.includes('useDisasterLayer();') &&
        disasterSource.includes("disaster-wildfire-points") &&
        disasterSource.includes("disaster-earthquake-ripple"),
    },
    {
      check: 'vulnerable-hook-mounted',
      ok:
        appPageSource.includes('useVulnerableLayer();') &&
        vulnerableSource.includes("vulnerable-amber-radius") &&
        vulnerableSource.includes("vulnerable-emergency-iot"),
    },
  ];

  console.table(realtimeChecks);

  const completeDomains = domainRows.filter((row) => row.complete).length;
  const completeChecks = realtimeChecks.filter((row) => row.ok).length;
  const totalChecks = domainRows.length + realtimeChecks.length;
  const progress = Math.round(((completeDomains + completeChecks) / totalChecks) * 100);

  console.log(
    `Team2 Phase3 progress (source-scan): domains ${completeDomains}/${domainRows.length}, realtime ${completeChecks}/${realtimeChecks.length}, overall ${progress}%`
  );
}

async function main() {
  try {
    await runApiMode();
  } catch (error) {
    console.warn((error && error.message) || 'API mode failed. Falling back to source scan.');
    await runSourceMode();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
