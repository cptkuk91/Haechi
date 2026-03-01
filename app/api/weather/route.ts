import { NextResponse } from 'next/server';
import { resolveDomainPayload } from '@/app/api/_shared/domain-payload';

export async function GET() {
  const resolved = await resolveDomainPayload('weather');
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
      },
    }
  );
}
