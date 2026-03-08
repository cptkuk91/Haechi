import { NextResponse } from 'next/server';
import { markUticAvailability } from '@/app/api/cctv/_shared/availability-cache';
import {
  buildUticStreamPageUrl,
  compactQueryParam,
  fetchUticItems,
  findDirectUticItem,
  isTrafficQualifiedUticItem,
  scoreByDistance,
  scoreByKindPriority,
  scoreByNamePriority,
  toFiniteNumber,
  toText,
  type UticCctvItem,
} from '@/app/api/cctv/_shared/utic';

const SOURCE_LABEL = '출처: 경찰청 도시교통정보센터(UTIC)';
const NO_SIGNAL_MESSAGE = '영상 신호를 수신할 수 없습니다.';
const COORDINATE_DISTANCE_GATE = 0.00008;
const COORDINATE_NEARBY_LIMIT = 12;

export const runtime = 'nodejs';

type UpstreamSource = 'mock' | 'upstream';
type MatchStrategy = 'cctv-id' | 'coordinate-distance';

function toBooleanParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function buildResponse(args: {
  source: UpstreamSource;
  streamUrl: string | null;
  streamKind: 'video' | 'iframe';
  errorMessage?: string;
  matched?: UticCctvItem | null;
  matchStrategy?: MatchStrategy | null;
  fallbackIndex?: number;
  candidateCount?: number;
  warnings?: string[];
}) {
  return NextResponse.json(
    {
      source: args.source,
      updatedAt: new Date().toISOString(),
      streamUrl: args.streamUrl,
      streamKind: args.streamKind,
      sourceLabel: SOURCE_LABEL,
      matched: args.matched
        ? {
            cctvId: args.matched.CCTVID ?? null,
            name: args.matched.CCTVNAME ?? null,
            kind: args.matched.KIND ?? null,
            xcoord: args.matched.XCOORD ?? null,
            ycoord: args.matched.YCOORD ?? null,
          }
        : null,
      matchStrategy: args.matchStrategy ?? null,
      fallbackIndex: args.fallbackIndex ?? 0,
      candidateCount: args.candidateCount ?? 0,
      ...(args.errorMessage
        ? {
            error: {
              code: 'NO_SIGNAL',
              message: args.errorMessage,
            },
          }
        : {}),
      ...(args.warnings && args.warnings.length > 0 ? { warnings: args.warnings } : {}),
    },
    {
      headers: {
        'cache-control': 'no-store, max-age=0',
        'x-team2-source': args.source,
      },
    }
  );
}

function pickCoordinateFallback(items: UticCctvItem[], lng: number, lat: number) {
  const measured = items
    .map((item) => ({
      item,
      distance: scoreByDistance(item, lng, lat),
    }))
    .filter((candidate) => Number.isFinite(candidate.distance))
    .sort((a, b) => a.distance - b.distance);

  const nearestDistance = measured[0]?.distance;
  if (nearestDistance === undefined) return null;

  const distanceGate = Math.max(nearestDistance * 20, COORDINATE_DISTANCE_GATE);
  const rankedNearby = measured
    .filter((candidate) => candidate.distance <= distanceGate)
    .slice(0, COORDINATE_NEARBY_LIMIT)
    .sort((a, b) => {
      const aPriority = scoreByNamePriority(a.item) + scoreByKindPriority(a.item);
      const bPriority = scoreByNamePriority(b.item) + scoreByKindPriority(b.item);
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.distance - b.distance;
    });

  if (rankedNearby.length === 0) return null;
  return {
    item: rankedNearby[0]?.item ?? null,
    candidateCount: rankedNearby.length,
  };
}

export async function GET(request: Request) {
  const key = toText(process.env.TEAM2_UTIC_CCTV_API_KEY);
  if (!key) {
    return buildResponse({
      source: 'mock',
      streamUrl: null,
      streamKind: 'iframe',
      errorMessage: `${NO_SIGNAL_MESSAGE} (Missing env: TEAM2_UTIC_CCTV_API_KEY)`,
      warnings: ['UTIC key is not configured.'],
    });
  }

  const url = new URL(request.url);
  const cctvId = compactQueryParam(url.searchParams.get('cctvId'));
  const lng = toFiniteNumber(url.searchParams.get('lng'));
  const lat = toFiniteNumber(url.searchParams.get('lat'));
  const allowCoordinateFallback =
    process.env.TEAM2_UTIC_CCTV_ALLOW_COORDINATE_FALLBACK === '1'
    || toBooleanParam(url.searchParams.get('debugFallback'));

  const warnings: string[] = [];
  const { items, warning } = await fetchUticItems(key);
  if (warning) {
    warnings.push(warning);
  }

  const trafficItems = items.filter(isTrafficQualifiedUticItem);
  if (trafficItems.length === 0) {
    return buildResponse({
      source: 'mock',
      streamUrl: null,
      streamKind: 'iframe',
      errorMessage: `${NO_SIGNAL_MESSAGE} (UTIC 교통 CCTV 목록 없음)`,
      warnings: warnings.length > 0 ? warnings : ['UTIC traffic CCTV list is empty.'],
    });
  }

  let matched = findDirectUticItem(trafficItems, cctvId);
  let matchStrategy: MatchStrategy | null = matched ? 'cctv-id' : null;
  let candidateCount = matched ? 1 : 0;

  if (!matched && allowCoordinateFallback && lng !== null && lat !== null) {
    const fallback = pickCoordinateFallback(trafficItems, lng, lat);
    if (fallback?.item) {
      matched = fallback.item;
      matchStrategy = 'coordinate-distance';
      candidateCount = fallback.candidateCount;
      warnings.push(
        cctvId
          ? `Direct match failed for ${cctvId}; coordinate fallback enabled for debug use`
          : 'Coordinate fallback enabled for debug use'
      );
    }
  }

  if (!matched) {
    if (cctvId) {
      await markUticAvailability({
        uticId: cctvId,
        playable: false,
        reason: 'direct-match-failed',
      });
    }

    return buildResponse({
      source: 'mock',
      streamUrl: null,
      streamKind: 'iframe',
      errorMessage: cctvId
        ? `${NO_SIGNAL_MESSAGE} (UTIC direct match 실패: ${cctvId})`
        : `${NO_SIGNAL_MESSAGE} (Missing query: cctvId)`,
      matchStrategy,
      candidateCount,
      warnings: warnings.length > 0 ? warnings : ['No UTIC CCTV matched the requested id.'],
    });
  }

  return buildResponse({
    source: 'upstream',
    streamUrl: buildUticStreamPageUrl(matched, key),
    streamKind: 'iframe',
    matched,
    matchStrategy,
    candidateCount,
    warnings,
  });
}
