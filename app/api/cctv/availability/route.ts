import { NextResponse } from 'next/server';
import { markUticAvailability } from '@/app/api/cctv/_shared/availability-cache';

export const runtime = 'nodejs';

function toCompactText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid JSON body',
      },
      { status: 400 }
    );
  }

  const payload = body as {
    cctvId?: unknown;
    playable?: unknown;
    reason?: unknown;
  };

  const cctvId = toCompactText(payload.cctvId);
  if (!cctvId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Missing field: cctvId',
      },
      { status: 400 }
    );
  }

  await markUticAvailability({
    uticId: cctvId,
    playable: payload.playable === true,
    reason: toCompactText(payload.reason),
  });

  return NextResponse.json({
    ok: true,
    updatedAt: new Date().toISOString(),
  });
}
