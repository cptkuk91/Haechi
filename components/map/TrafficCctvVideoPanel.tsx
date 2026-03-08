'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PIPPanel from '@/components/map/PIPPanel';
import { useAppStore } from '@/stores/app-store';
import type { SelectedObject } from '@/types/domain';

const SOURCE_LABEL = '출처: 경찰청 도시교통정보센터(UTIC)';
const NO_SIGNAL_MESSAGE = '영상 신호를 수신할 수 없습니다.';
const UTIC_UNAVAILABLE_MESSAGE = 'UTIC에서 현재 미제공(중단/점검)인 영상입니다.';
const IFRAME_LOAD_GUARD_TIMEOUT_MS = 15_000;
const VIDEO_PLAY_GUARD_TIMEOUT_MS = 30_000;

interface CctvStreamAPIResponse {
  source?: 'mock' | 'upstream';
  updatedAt?: string;
  streamUrl?: string | null;
  streamKind?: 'video' | 'iframe';
  sourceLabel?: string;
  matchStrategy?: 'cctv-id' | 'coordinate-distance' | null;
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
  contentLoaded: boolean;
  playerErrorMessage: string | null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTrafficControlCctv(selectedObject: SelectedObject | null): selectedObject is SelectedObject {
  if (!selectedObject) return false;
  if (selectedObject.domain !== 'cctv') return false;
  const source = toText(selectedObject.properties.source)?.toLowerCase();
  return source === 'utic' || source === 'vworld';
}

function getUnavailableDetail(): string {
  return '직접 매칭된 UTIC 영상만 표시하며, 재생 실패 이력은 이후 지도 조회에서 숨김 처리됩니다.';
}

function postAvailabilityReport(args: {
  cctvId: string;
  playable: boolean;
  reason: string;
}) {
  return fetch('/api/cctv/availability', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    keepalive: true,
  });
}

export default function TrafficCctvVideoPanel() {
  const selectedObject = useAppStore((s) => s.selectedObject);
  const queryClient = useQueryClient();
  const [closedSelection, setClosedSelection] = useState<SelectedObject | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    sessionKey: '',
    contentLoaded: false,
    playerErrorMessage: null,
  });
  const reportedAvailabilityKeys = useRef<Set<string>>(new Set());

  const trafficSelection = useMemo(
    () => (isTrafficControlCctv(selectedObject) ? selectedObject : null),
    [selectedObject]
  );
  const selectionKey = trafficSelection
    ? `${trafficSelection.id}:${trafficSelection.coordinates[0].toFixed(6)}:${trafficSelection.coordinates[1].toFixed(6)}`
    : 'none';

  const reportAvailability = useCallback((playable: boolean, reason: string) => {
    if (!trafficSelection) return;
    const key = `${selectionKey}:${playable ? 'ok' : 'fail'}:${reason}`;
    if (reportedAvailabilityKeys.current.has(key)) return;
    reportedAvailabilityKeys.current.add(key);
    void postAvailabilityReport({
      cctvId: trafficSelection.id,
      playable,
      reason,
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ['cctv', 'positions'] }))
      .catch(() => {
        // Availability cache telemetry should not block playback UI.
      });
  }, [queryClient, selectionKey, trafficSelection]);

  const streamQuery = useQuery({
    queryKey: ['cctv', 'stream', trafficSelection?.id],
    queryFn: async ({ signal }) => {
      if (!trafficSelection) {
        return null;
      }

      const params = new URLSearchParams({
        cctvId: trafficSelection.id,
        lng: String(trafficSelection.coordinates[0]),
        lat: String(trafficSelection.coordinates[1]),
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
  const noSignalTitle = '스트림 연결 실패';

  const playbackSessionKey = `${selectionKey}:${streamKind}:${streamUrl ?? 'none'}`;
  const currentPlayback =
    playbackState.sessionKey === playbackSessionKey
      ? playbackState
      : {
          sessionKey: playbackSessionKey,
          contentLoaded: false,
          playerErrorMessage: null,
        };

  const setCurrentPlayback = (patch: Partial<Omit<PlaybackState, 'sessionKey'>>) => {
    setPlaybackState((prev) => {
      const base =
        prev.sessionKey === playbackSessionKey
          ? prev
          : {
              sessionKey: playbackSessionKey,
              contentLoaded: false,
              playerErrorMessage: null,
            };
      return {
        ...base,
        ...patch,
        sessionKey: playbackSessionKey,
      };
    });
  };

  useEffect(() => {
    if (!trafficSelection) return;
    if (shouldShowLoading) return;
    if (streamUrl) return;
    if (!errorMessage) return;
    if (isAbortedError) return;

    reportAvailability(false, 'stream-query-failed');
  }, [errorMessage, isAbortedError, reportAvailability, shouldShowLoading, streamUrl, trafficSelection]);

  useEffect(() => {
    if (!streamUrl) return;
    if (currentPlayback.playerErrorMessage) return;
    if (currentPlayback.contentLoaded) return;

    const timeoutMs = streamKind === 'iframe'
      ? IFRAME_LOAD_GUARD_TIMEOUT_MS
      : VIDEO_PLAY_GUARD_TIMEOUT_MS;
    const timeoutReason = streamKind === 'iframe'
      ? 'UTIC iframe 페이지를 불러오지 못했습니다.'
      : UTIC_UNAVAILABLE_MESSAGE;

    const timer = window.setTimeout(() => {
      setPlaybackState((prev) => {
        if (prev.sessionKey !== playbackSessionKey) return prev;
        if (prev.contentLoaded || prev.playerErrorMessage) return prev;
        return {
          ...prev,
          playerErrorMessage: timeoutReason,
        };
      });
      reportAvailability(false, streamKind === 'iframe' ? 'iframe-load-timeout' : 'video-play-timeout');
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [
    currentPlayback.contentLoaded,
    currentPlayback.playerErrorMessage,
    playbackSessionKey,
    reportAvailability,
    streamKind,
    streamUrl,
  ]);

  if (!trafficSelection || trafficSelection === closedSelection) {
    return null;
  }

  const panelTitle = '교통관제 CCTV';
  const shouldShowUnavailableNotice = Boolean(streamUrl && currentPlayback.playerErrorMessage);
  const unavailableDetail = getUnavailableDetail();

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
                        contentLoaded: true,
                        playerErrorMessage: null,
                      });
                      reportAvailability(true, 'video-playing');
                    }}
                    onError={() => {
                      setCurrentPlayback({
                        contentLoaded: false,
                        playerErrorMessage: UTIC_UNAVAILABLE_MESSAGE,
                      });
                      reportAvailability(false, 'video-error');
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
                        contentLoaded: true,
                        playerErrorMessage: null,
                      });
                      reportAvailability(true, 'iframe-loaded');
                    }}
                    onError={() => {
                      setCurrentPlayback({
                        contentLoaded: false,
                        playerErrorMessage: UTIC_UNAVAILABLE_MESSAGE,
                      });
                      reportAvailability(false, 'iframe-error');
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
                  </div>
                )}
                {!shouldShowLoading && !streamUrl && (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-cyan-200">
                    <span className="text-[11px] tracking-[0.15em]">{noSignalTitle}</span>
                    <span className="max-w-[92%] text-center text-[9px] text-cyan-400">
                      {errorMessage}
                    </span>
                  </div>
                )}
              </div>
              <div className="px-2 py-1 border-t border-cyan-900/40 text-[9px] text-cyan-300/90 tracking-wide">
                <div>{sourceLabel}</div>
                <div className="text-[8px] text-cyan-400/90">
                  매칭 방식: UTIC 직접 매칭
                </div>
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
