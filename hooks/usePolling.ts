'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

export function usePolling(queryKey: QueryKey, intervalMs = 45_000, enabled = true): void {
  const queryClient = useQueryClient();
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  // Serialize the queryKey so the effect only re-runs when the value changes,
  // not when the array reference changes on every render.
  const stableKey = JSON.stringify(queryKey);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeyRef.current });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs, queryClient, stableKey]);
}
