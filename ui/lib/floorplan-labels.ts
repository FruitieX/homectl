import type { FloorplanGrid } from './floorplan-editor';

export type FloorplanLayers = {
  lights: boolean;
  sensors: boolean;
  groups: boolean;
};

/** Old layouts keep their device labels and existing room labels. */
export function floorplanLabels(
  grid?: Pick<FloorplanGrid, 'labelMode' | 'labelVisibility'> | null,
): FloorplanLayers {
  if (grid?.labelVisibility) return grid.labelVisibility;
  const mode = grid?.labelMode ?? 'sensors';
  return {
    lights: mode === 'lights' || mode === 'all',
    sensors: mode === 'sensors' || mode === 'all',
    groups: mode !== 'none',
  };
}

export function validFloorplanLayers(value: unknown): value is FloorplanLayers {
  return (
    !!value &&
    typeof value === 'object' &&
    ['lights', 'sensors', 'groups'].every(
      (key) => typeof (value as Record<string, unknown>)[key] === 'boolean',
    )
  );
}

/**
 * Label layers for an embedded preview: such maps are too small for label
 * text, so every label is hidden regardless of the floorplan's own settings
 * (the surrounding list names the entities instead). Returns a fresh object so
 * a consumer can adjust its own copy without affecting the next scene.
 */
export function hiddenFloorplanLabels(): FloorplanLayers {
  return { lights: false, sensors: false, groups: false };
}
