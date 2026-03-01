import { NextResponse } from 'next/server';
import { isTeam2DomainRoute, resolveDomainPayload } from '@/app/api/_shared/domain-payload';

export async function GET(
  _request: Request,
  context: { params: Promise<{ domain: string }> }
) {
  const { domain } = await context.params;

  if (!isTeam2DomainRoute(domain)) {
    return NextResponse.json(
      {
        error: `Unsupported domain: ${domain}`,
        supported: ['traffic', 'weather', 'disaster', 'infra', 'crime', 'health', 'vulnerable'],
      },
      { status: 404 }
    );
  }

  const resolved = await resolveDomainPayload(domain);

  return NextResponse.json(
    {
      ...resolved.payload,
      source: resolved.source,
      warnings: resolved.warnings,
      ruleDiagnostics: resolved.ruleDiagnostics,
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': resolved.source,
        ...(resolved.warnings.length > 0
          ? { 'x-team2-warnings': encodeURIComponent(resolved.warnings.join(' | ')) }
          : {}),
      },
    }
  );
}
