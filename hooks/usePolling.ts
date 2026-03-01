'use client';

import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

export function usePolling(queryKey: QueryKey, intervalMs = 45_000, enabled = true): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs, queryClient, queryKey]);
}
