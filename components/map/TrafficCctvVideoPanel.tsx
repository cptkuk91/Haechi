'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PIPPanel from '@/components/map/PIPPanel';
import { useAppStore } from '@/stores/app-store';
import type { SelectedObject } from '@/types/domain';

const SOURCE_LABEL = '출처: 경찰청 도시교통정보센터(UTIC)';
const NO_SIGNAL_MESSAGE = '영상 신호를 수신할 수 없습니다.';
const UTIC_UNAVAILABLE_MESSAGE = 'UTIC에서 현재 미제공(중단/점검)인 영상입니다.';
const PLAYBACK_GUARD_TIMEOUT_MS = 30_000;
const MAX_MANUAL_FALLBACK_ATTEMPTS = 6;

interface CctvStreamAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  streamUrl?: string | null;
  streamKind?: 'video' | 'iframe';
  sourceLabel?: string;
  matchStrategy?: 'cctv-id' | 'coordinate-distance' | 'first-item' | null;
  fallbackIndex?: number;
  candidateCount?: number;
  matched?: {
    cctvId?: string | null;
    name?: string | null;
    kind?: string | null;
    xcoord?: string | number | null;
    ycoord?: string | number | null;
  } | null;
  error?: {
    code?: string;
    message?: string;
  };
  warnings?: string[];
}

interface PlaybackState {
  sessionKey: string;
  videoStarted: boolean;
  playerErrorMessage: string | null;
}

interface FallbackState {
  selectionKey: string;
  attempt: number;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTrafficControlCctv(selectedObject: SelectedObject | null): selectedObject is SelectedObject {
  if (!selectedObject) return false;
  if (selectedObject.domain !== 'cctv') return false;
  return toText(selectedObject.properties.source)?.toLowerCase() === 'vworld';
}

function getUnavailableDetail(data: CctvStreamAPIResponse | null | undefined): string {
  if (data?.matchStrategy === 'coordinate-distance') {
    return '요청 CCTV ID가 직접 매칭되지 않아 인접 CCTV를 대체 표시 중입니다.';
  }
  return '해당 영상은 UTIC 제공처에서 일시 중단되었거나 브라우저 재생 형식이 지원되지 않습니다.';
}

export default function TrafficCctvVideoPanel() {
  const selectedObject = useAppStore((s) => s.selectedObject);
  const [closedSelection, setClosedSelection] = useState<SelectedObject | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    sessionKey: '',
    videoStarted: false,
    playerErrorMessage: null,
  });
  const [fallbackState, setFallbackState] = useState<FallbackState>({
    selectionKey: '',
    attempt: 0,
  });

  const trafficSelection = useMemo(
    () => (isTrafficControlCctv(selectedObject) ? selectedObject : null),
    [selectedObject]
  );
  const selectionKey = trafficSelection
    ? `${trafficSelection.id}:${trafficSelection.coordinates[0].toFixed(6)}:${trafficSelection.coordinates[1].toFixed(6)}`
    : 'none';
  const fallbackAttempt = fallbackState.selectionKey === selectionKey ? fallbackState.attempt : 0;

  const setFallbackAttempt = (nextAttempt: number) => {
    const clamped = Math.min(Math.max(nextAttempt, 0), MAX_MANUAL_FALLBACK_ATTEMPTS);
    setFallbackState((prev) => {
      if (prev.selectionKey === selectionKey && prev.attempt === clamped) {
        return prev;
      }
      return {
        selectionKey,
        attempt: clamped,
      };
    });
  };

  const streamQuery = useQuery({
    queryKey: [
      'cctv',
      'stream',
      trafficSelection?.id,
      trafficSelection?.coordinates[0],
      trafficSelection?.coordinates[1],
      fallbackAttempt,
    ],
    queryFn: async ({ signal }) => {
      if (!trafficSelection) {
        return null;
      }

      const params = new URLSearchParams({
        cctvId: trafficSelection.id,
        lng: String(trafficSelection.coordinates[0]),
        lat: String(trafficSelection.coordinates[1]),
        fallback: String(fallbackAttempt),
      });

      const response = await fetch(`/api/cctv/stream?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
        signal,
      });
      if (!response.ok) {
        throw new Error(`Failed to load CCTV stream: ${response.status}`);
      }

      return (await response.json()) as CctvStreamAPIResponse;
    },
    enabled: Boolean(trafficSelection),
    staleTime: 0,
    retry: 2,
    retryDelay: (attempt) => Math.min((attempt + 1) * 1_200, 3_600),
    refetchOnWindowFocus: false,
  });

  const streamUrl = toText(streamQuery.data?.streamUrl);
  const streamKind = streamQuery.data?.streamKind ?? 'video';
  const sourceLabel = toText(streamQuery.data?.sourceLabel) ?? SOURCE_LABEL;
  const queryErrorRaw = streamQuery.error instanceof Error ? streamQuery.error.message : null;
  const isAbortedError = queryErrorRaw?.toLowerCase().includes('aborted') ?? false;
  const queryError = isAbortedError ? '스트림 전환 중 재요청되었습니다.' : queryErrorRaw;
  const shouldShowLoading = !streamUrl && (streamQuery.isPending || streamQuery.isFetching || isAbortedError);
  const errorMessage = streamUrl
    ? null
    : (toText(streamQuery.data?.error?.message) ?? queryError ?? NO_SIGNAL_MESSAGE);
  const isCoordinateFallback = streamQuery.data?.matchStrategy === 'coordinate-distance';
  const candidateCount = streamQuery.data?.candidateCount ?? 0;
  const activeCandidateIndex = streamQuery.data?.fallbackIndex ?? fallbackAttempt;
  const hasMoreFallbackCandidates = isCoordinateFallback && candidateCount > activeCandidateIndex + 1;
  const showFallbackControls = isCoordinateFallback && candidateCount > 1;
  const noSignalTitle = '스트림 연결 실패';

  const playbackSessionKey = `${selectionKey}:${fallbackAttempt}:${streamKind}:${streamUrl ?? 'none'}`;
  const currentPlayback =
    playbackState.sessionKey === playbackSessionKey
      ? playbackState
      : {
          sessionKey: playbackSessionKey,
          videoStarted: false,
          playerErrorMessage: null,
        };

  const setCurrentPlayback = (patch: Partial<Omit<PlaybackState, 'sessionKey'>>) => {
    setPlaybackState((prev) => {
      const base =
        prev.sessionKey === playbackSessionKey
          ? prev
          : {
              sessionKey: playbackSessionKey,
              videoStarted: false,
              playerErrorMessage: null,
            };
      return {
        ...base,
        ...patch,
        sessionKey: playbackSessionKey,
      };
    });
  };

  const panelTitle = '교통관제 CCTV';
  const shouldShowUnavailableNotice = Boolean(streamUrl && currentPlayback.playerErrorMessage);
  const unavailableDetail = getUnavailableDetail(streamQuery.data);

  useEffect(() => {
    if (!streamUrl) return;
    if (currentPlayback.playerErrorMessage) return;

    if (streamKind !== 'video') return;
    if (currentPlayback.videoStarted) return;

    const timer = window.setTimeout(() => {
      setPlaybackState((prev) => {
        if (prev.sessionKey !== playbackSessionKey) return prev;
        if (prev.videoStarted || prev.playerErrorMessage) return prev;
        return {
          ...prev,
          playerErrorMessage: UTIC_UNAVAILABLE_MESSAGE,
        };
      });
    }, PLAYBACK_GUARD_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [currentPlayback.playerErrorMessage, currentPlayback.videoStarted, playbackSessionKey, streamKind, streamUrl]);

  if (!trafficSelection || trafficSelection === closedSelection) {
    return null;
  }

  return (
    <PIPPanel
      items={[
        {
          id: trafficSelection.id,
          title: panelTitle,
          content: (
            <div className="w-full h-full flex flex-col">
              <div className="relative flex-1 min-h-0 bg-black/60">
                {shouldShowLoading && !streamUrl && (
                  <div className="w-full h-full flex items-center justify-center text-cyan-300 text-[10px] tracking-widest">
                    STREAM LOADING...
                  </div>
                )}
                {streamUrl && streamKind === 'video' && (
                  <video
                    src={streamUrl}
                    autoPlay
                    muted
                    controls
                    playsInline
                    className="w-full h-full object-cover"
                    onPlaying={() => {
                      setCurrentPlayback({
                        videoStarted: true,
                        playerErrorMessage: null,
                      });
                    }}
                    onError={() => {
                      setCurrentPlayback({
                        playerErrorMessage: UTIC_UNAVAILABLE_MESSAGE,
                      });
                    }}
                  />
                )}
                {streamUrl && streamKind === 'iframe' && (
                  <iframe
                    src={streamUrl}
                    className="w-full h-full border-0"
                    title={panelTitle}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    allow="autoplay; fullscreen"
                    onLoad={() => {
                      setCurrentPlayback({
                        playerErrorMessage: null,
                      });
                    }}
                    onError={() => {
                      setCurrentPlayback({
                        playerErrorMessage: UTIC_UNAVAILABLE_MESSAGE,
                      });
                    }}
                  />
                )}
                {shouldShowUnavailableNotice && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/70 px-4 text-cyan-100">
                    <span className="text-[11px] tracking-[0.2em]">UTIC 미제공</span>
                    <span className="text-center text-[10px] text-cyan-300">
                      {currentPlayback.playerErrorMessage}
                    </span>
                    <span className="text-center text-[9px] text-cyan-400">
                      {unavailableDetail}
                    </span>
                    {streamUrl && (
                      <button
                        type="button"
                        className="rounded border border-cyan-600/60 px-2 py-1 text-[9px] text-cyan-200 hover:bg-cyan-900/40"
                        onClick={() => {
                          window.open(streamUrl, '_blank', 'noopener,noreferrer');
                        }}
                      >
                        원본 페이지 열기
                      </button>
                    )}
                    {showFallbackControls && (
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[9px] text-amber-300/90">
                          대체 후보 {Math.min(activeCandidateIndex + 1, candidateCount)}/{candidateCount}
                        </span>
                        {hasMoreFallbackCandidates && (
                          <button
                            type="button"
                            className="rounded border border-amber-400/60 px-2 py-1 text-[9px] text-amber-200 hover:bg-amber-900/30"
                            onClick={() => {
                              setFallbackAttempt(activeCandidateIndex + 1);
                            }}
                          >
                            다음 후보 시도
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {!shouldShowLoading && !streamUrl && (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-cyan-200">
                    <span className="text-[11px] tracking-[0.15em]">{noSignalTitle}</span>
                    <span className="max-w-[92%] text-center text-[9px] text-cyan-400">
                      {errorMessage}
                    </span>
                    {isCoordinateFallback && (
                      <span className="max-w-[92%] text-center text-[9px] text-amber-300/90">
                        요청 CCTV를 찾지 못해 인접 CCTV로 대체 조회 중입니다.
                      </span>
                    )}
                    {showFallbackControls && hasMoreFallbackCandidates && (
                      <button
                        type="button"
                        className="rounded border border-amber-400/60 px-2 py-1 text-[9px] text-amber-200 hover:bg-amber-900/30"
                        onClick={() => {
                          setFallbackAttempt(activeCandidateIndex + 1);
                        }}
                      >
                        다음 후보 시도 ({Math.min(activeCandidateIndex + 2, candidateCount)}/{candidateCount})
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="px-2 py-1 border-t border-cyan-900/40 text-[9px] text-cyan-300/90 tracking-wide">
                <div>{sourceLabel}</div>
                {isCoordinateFallback && (
                  <div className="text-[8px] text-amber-300/90">
                    매칭 방식: 인접 CCTV 대체 ({Math.min(activeCandidateIndex + 1, candidateCount)}/{candidateCount})
                  </div>
                )}
              </div>
            </div>
          ),
        },
      ]}
      onClose={() => setClosedSelection(trafficSelection)}
      className="absolute top-20 left-4 z-[75] flex flex-col gap-3 pointer-events-auto"
    />
  );
}
