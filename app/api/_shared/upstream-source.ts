import type { Team2DomainRoute } from '@/app/api/_shared/domain-payload';

interface UpstreamFetchResult {
  raw: unknown | null;
  warnings: string[];
}

const DOMAIN_UPSTREAM_ENV: Record<Team2DomainRoute, string> = {
  traffic: 'TEAM2_TRAFFIC_UPSTREAM_URL',
  weather: 'TEAM2_WEATHER_UPSTREAM_URL',
  disaster: 'TEAM2_DISASTER_UPSTREAM_URL',
  infra: 'TEAM2_INFRA_UPSTREAM_URL',
  crime: 'TEAM2_CRIME_UPSTREAM_URL',
  health: 'TEAM2_HEALTH_UPSTREAM_URL',
  vulnerable: 'TEAM2_VULNERABLE_UPSTREAM_URL',
};

function buildUpstreamURL(domain: Team2DomainRoute): { url: string | null; warning?: string } {
  const envName = DOMAIN_UPSTREAM_ENV[domain];
  const base = process.env[envName];

  if (!base) {
    return { url: null, warning: `Missing upstream URL env: ${envName}` };
  }

  const key = process.env[`TEAM2_${domain.toUpperCase()}_API_KEY`] ?? process.env.TEAM2_PUBLIC_API_KEY;
  const keyParam = process.env.TEAM2_PUBLIC_API_KEY_PARAM ?? 'serviceKey';

  try {
    const url = new URL(base);
    if (key && keyParam && !url.searchParams.has(keyParam)) {
      url.searchParams.set(keyParam, key);
    }
    return { url: url.toString() };
  } catch {
    return { url: null, warning: `Invalid upstream URL in ${envName}` };
  }
}

export async function fetchDomainUpstream(domain: Team2DomainRoute): Promise<UpstreamFetchResult> {
  const warnings: string[] = [];
  const { url, warning } = buildUpstreamURL(domain);

  if (warning) warnings.push(warning);
  if (!url) {
    return { raw: null, warnings };
  }

  const timeoutMs = Number(process.env.TEAM2_UPSTREAM_TIMEOUT_MS ?? 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      warnings.push(`Upstream responded ${response.status} for ${domain}`);
      return { raw: null, warnings };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return { raw: await response.json(), warnings };
    }

    const text = await response.text();
    try {
      return { raw: JSON.parse(text), warnings };
    } catch {
      warnings.push(`Upstream response is not JSON for ${domain}`);
      return { raw: null, warnings };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    warnings.push(`Upstream fetch failed for ${domain}: ${message}`);
    return { raw: null, warnings };
  } finally {
    clearTimeout(timeout);
  }
}
