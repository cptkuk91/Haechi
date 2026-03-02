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

const DOMAIN_KEY_OVERRIDE_ENV: Partial<Record<Team2DomainRoute, string>> = {
  traffic: 'TEAM2_TRAFFIC_SEOUL_INCIDENT_API_KEY',
};

function interpolateUpstreamTemplate(
  rawUrl: string,
  domain: Team2DomainRoute,
  key: string | undefined
): { url: string; usesTemplate: boolean; warning?: string } {
  const usesTemplate = /\{KEY\}|\{TYPE\}|\{SERVICE\}|\{START_INDEX\}|\{END_INDEX\}/i.test(rawUrl);
  if (!usesTemplate) return { url: rawUrl, usesTemplate: false };

  if (!key || !key.trim()) {
    return {
      url: rawUrl,
      usesTemplate: true,
      warning: 'Missing API key for upstream URL template token {KEY}',
    };
  }

  const domainUpper = domain.toUpperCase();
  const serviceFallback = domain === 'traffic' ? 'AccInfo' : domain;
  const templateValues: Record<string, string> = {
    KEY: key,
    TYPE: process.env[`TEAM2_${domainUpper}_UPSTREAM_TYPE`] ?? 'xml',
    SERVICE: process.env[`TEAM2_${domainUpper}_UPSTREAM_SERVICE`] ?? serviceFallback,
    START_INDEX: process.env[`TEAM2_${domainUpper}_UPSTREAM_START_INDEX`] ?? '1',
    END_INDEX: process.env[`TEAM2_${domainUpper}_UPSTREAM_END_INDEX`] ?? '1000',
  };

  let interpolated = rawUrl;
  for (const [token, value] of Object.entries(templateValues)) {
    interpolated = interpolated.replace(new RegExp(`\\{${token}\\}`, 'gi'), encodeURIComponent(value));
  }

  return { url: interpolated, usesTemplate: true };
}

function buildUpstreamURL(domain: Team2DomainRoute): { url: string | null; warning?: string } {
  const envName = DOMAIN_UPSTREAM_ENV[domain];
  const base = process.env[envName];

  if (!base) {
    return { url: null, warning: `Missing upstream URL env: ${envName}` };
  }

  const overrideKeyEnv = DOMAIN_KEY_OVERRIDE_ENV[domain];
  const overrideKey = overrideKeyEnv ? process.env[overrideKeyEnv] : undefined;
  const domainKey = process.env[`TEAM2_${domain.toUpperCase()}_API_KEY`];
  const key = overrideKey ?? domainKey ?? process.env.TEAM2_PUBLIC_API_KEY;
  const keyParam = process.env.TEAM2_PUBLIC_API_KEY_PARAM ?? 'serviceKey';
  const templated = interpolateUpstreamTemplate(base, domain, key);
  if (templated.warning) {
    return { url: null, warning: templated.warning };
  }

  try {
    const url = new URL(templated.url);
    if (!templated.usesTemplate && key && keyParam && !url.searchParams.has(keyParam)) {
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
      // XML/CSV 등 비JSON 응답도 downstream normalizer에서 처리할 수 있도록 raw를 전달한다.
      if (!text.trim()) {
        warnings.push(`Upstream response is empty for ${domain}`);
        return { raw: null, warnings };
      }
      return { raw: text, warnings };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    warnings.push(`Upstream fetch failed for ${domain}: ${message}`);
    return { raw: null, warnings };
  } finally {
    clearTimeout(timeout);
  }
}
