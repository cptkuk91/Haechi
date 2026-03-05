'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/stores/app-store';
import { deriveFeatureObjectId, toSelectedObjectFromFeature } from '@/lib/selected-object';
import type { SelectedObject } from '@/types/domain';

function hasCoordinatesChanged(prev: [number, number], next: [number, number]): boolean {
  return Math.abs(prev[0] - next[0]) > 1e-6 || Math.abs(prev[1] - next[1]) > 1e-6;
}

function hasPropertiesChanged(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;

  for (const key of prevKeys) {
    if (!(key in next)) return true;
    if (prev[key] !== next[key]) return true;
  }

  return false;
}

function hasSelectionChanged(prev: SelectedObject, next: SelectedObject): boolean {
  if (prev.id !== next.id || prev.domain !== next.domain || prev.type !== next.type) {
    return true;
  }

  if (hasCoordinatesChanged(prev.coordinates, next.coordinates)) {
    return true;
  }

  return hasPropertiesChanged(prev.properties, next.properties);
}

export function useSelectedObjectBinding() {
  const selectedObject = useAppStore((s) => s.selectedObject);
  const layers = useAppStore((s) => s.layers);
  const selectObject = useAppStore((s) => s.selectObject);

  useEffect(() => {
    if (!selectedObject) return;

    let nextSelection: SelectedObject | null = null;

    for (const layer of Object.values(layers)) {
      if (!layer.visible || layer.domain !== selectedObject.domain || !layer.data?.features?.length) continue;

      for (const feature of layer.data.features) {
        const objectId = deriveFeatureObjectId(feature, layer.id);
        if (objectId !== selectedObject.id) continue;

        nextSelection = toSelectedObjectFromFeature(feature, {
          id: layer.id,
          domain: layer.domain,
          type: layer.type,
        });
        break;
      }

      if (nextSelection) break;
    }

    if (nextSelection && hasSelectionChanged(selectedObject, nextSelection)) {
      selectObject(nextSelection);
    }
  }, [layers, selectObject, selectedObject]);
}
