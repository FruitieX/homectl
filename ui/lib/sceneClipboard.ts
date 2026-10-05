import type { SceneDeviceConfig } from '../hooks/useConfig';
import { sceneTargetMode } from './sceneTargets.ts';
import { formatColorExact } from './deviceColor.ts';

/**
 * Copy/paste of scene target definitions inside the scene editor. A copied
 * target is the saved definition (not a resolved preview), so a pasted target
 * behaves exactly like its source, including follow-device/scene links.
 */
export type SceneClipboard = {
  config: SceneDeviceConfig;
  /** Display name of the row it was copied from. */
  sourceName: string;
  sourceKey: string;
  sceneId?: string;
};

export const PASTE_FIELDS = [
  'power',
  'brightness',
  'color',
  'transition',
] as const;
export type PasteField = (typeof PASTE_FIELDS)[number];

export const PASTE_FIELD_LABELS: Record<PasteField, string> = {
  power: 'Power',
  brightness: 'Brightness',
  color: 'Color',
  transition: 'Fade',
};

/** Whether individual fields can be pasted, or only the whole definition. */
export function clipboardIsState(clip: SceneClipboard): boolean {
  return sceneTargetMode(clip.config) === 'state';
}

/** Fields the copied state sets explicitly. */
export function clipboardFields(clip: SceneClipboard): PasteField[] {
  if (!clipboardIsState(clip)) return [];
  const config = clip.config as Record<string, unknown>;
  return PASTE_FIELDS.filter((field) => config[field] != null);
}

/**
 * Paste a copied target onto another one. Without `fields`, the target becomes
 * an exact copy. With `fields`, only those state fields are written: a field
 * the copy leaves unset is cleared on the target too, so "paste brightness"
 * from a default-brightness row resets to the default. A link target becomes a
 * state target before a field paste, since links have no per-field state.
 */
export function pasteSceneTarget(
  target: SceneDeviceConfig,
  clip: SceneClipboard,
  fields?: readonly PasteField[],
): SceneDeviceConfig {
  if (!fields || !clipboardIsState(clip)) return structuredClone(clip.config);
  const source = clip.config as Record<string, unknown>;
  const next: Record<string, unknown> =
    sceneTargetMode(target) === 'state' ? { ...target } : {};
  for (const field of fields) {
    if (source[field] == null) delete next[field];
    else next[field] = structuredClone(source[field]);
  }
  return next as SceneDeviceConfig;
}

/** One line describing the copied definition, for the clipboard bar. */
export function describeClipboard(clip: SceneClipboard): string {
  const config = clip.config as Record<string, unknown>;
  const mode = sceneTargetMode(config);
  if (mode === 'scene-link')
    return `Follows scene ${String(config.scene_id) || '(not chosen)'}`;
  if (mode === 'device-link')
    return `Follows ${config.device_id ? `${String(config.integration_id)}/${String(config.device_id)}` : 'an unchosen device'}`;
  if (mode !== 'state') return 'Saved definition';
  const parts = [
    config.power === false ? 'Off' : config.power === true ? 'On' : null,
    typeof config.brightness === 'number'
      ? `${Math.round(config.brightness * 100)}%`
      : null,
    config.color
      ? formatColorExact(config.color as Parameters<typeof formatColorExact>[0])
      : null,
    typeof config.transition === 'number' ? `${config.transition}s fade` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'Defaults (on, full brightness)';
}
