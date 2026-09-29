import type {
  Scene,
  SceneDeviceConfig,
  SceneDeviceState,
  Group,
} from '../hooks/useConfig';
import type { DevicesState } from '../bindings/DevicesState';
import type { DeviceColor } from '../bindings/DeviceColor';
import { orderedSceneTargets } from './sceneTargets.ts';
import { groupDeviceKey, inheritedGroupDevices } from './groupGraph.ts';
import type { FieldError } from './configSection.ts';

export type DraftTargetState = {
  power?: boolean;
  brightness?: number;
  color?: DeviceColor;
  transition?: number;
  reason?: string;
};
export type SceneDraftContext = {
  scenes: readonly Scene[];
  groups: readonly Group[];
  devices: DevicesState;
  aliases?: Record<string, string>;
};
/** Session editor identity; escape keys so a device ID cannot overlap another slot. */
export function sceneTargetDraftPath(kind: 'group' | 'device', key: string) {
  return `scene-target/${kind}/${encodeURIComponent(key)}`;
}
export function groupMemberKeys(
  groupId: string,
  groups: readonly Group[],
): string[] {
  const group = groups.find((row) => row.id === groupId);
  return group
    ? [
        ...new Set([
          ...group.devices.map(groupDeviceKey),
          ...inheritedGroupDevices(group, groups).map((member) => member.key),
        ]),
      ]
    : [];
}
export function canonicalDeviceKey(
  key: string,
  context: SceneDraftContext,
): string {
  return context.devices[key] ? key : (context.aliases?.[key] ?? key);
}
/** Target-level preview. Script and manual overrides require the server's draft preview. */
export function resolveDraftTarget(
  config: SceneDeviceConfig,
  target: string,
  context: SceneDraftContext,
  seen = new Set<string>(),
): DraftTargetState {
  if ('integration_id' in config) {
    const key = canonicalDeviceKey(
      `${config.integration_id}/${config.device_id ?? ''}`,
      context,
    );
    const data = context.devices[key]?.data;
    const state =
      data &&
      ('Controllable' in data
        ? data.Controllable.state
        : 'power' in data.Sensor
          ? data.Sensor
          : undefined);
    if (!state) return { reason: 'The source has no light state to follow.' };
    return {
      power: state.power,
      color: state.color ?? undefined,
      brightness: state.power
        ? (state.brightness ?? 1) * (config.brightness ?? 1)
        : (state.brightness ?? undefined),
      transition: state.transition ?? undefined,
    };
  }
  if ('scene_id' in config) {
    const scene = context.scenes.find((row) => row.id === config.scene_id);
    if (!scene) return { reason: 'The referenced scene is missing.' };
    if (seen.has(scene.id) || seen.size >= 256)
      return {
        reason: 'These scene links form a loop or exceed the supported depth.',
      };
    if (scene.script?.trim())
      return {
        reason:
          'Use Preview draft to include the scene script and saved overrides.',
      };
    const nextSeen = new Set([...seen, scene.id]);
    let source: SceneDeviceConfig | undefined;
    for (const [groupId, value] of orderedSceneTargets(
      scene.group_states,
      scene.group_state_order,
    )) {
      if (
        groupMemberKeys(groupId, context.groups)
          .map((key) => canonicalDeviceKey(key, context))
          .includes(target)
      )
        source = value;
    }
    for (const [key, value] of Object.entries(scene.device_states))
      if (canonicalDeviceKey(key, context) === target) source = value;
    if (!source)
      return {
        reason: 'The referenced scene has no state for this target device.',
      };
    const resolved = resolveDraftTarget(source, target, context, nextSeen);
    return {
      ...resolved,
      ...(config.transition == null ? {} : { transition: config.transition }),
    };
  }
  return {
    power: config.power ?? true,
    brightness: config.brightness ?? (config.power === false ? undefined : 1),
    color: config.color ?? undefined,
    transition: config.transition ?? undefined,
  };
}
export function targetDeviceKeys(
  kind: 'device' | 'group',
  key: string,
  context: SceneDraftContext,
): string[] {
  return (kind === 'device' ? [key] : groupMemberKeys(key, context.groups)).map(
    (key) => canonicalDeviceKey(key, context),
  );
}
export function patchSceneTarget(
  config: SceneDeviceConfig,
  patch: Record<string, unknown>,
): SceneDeviceConfig {
  const next = { ...config, ...patch } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch))
    if (value === undefined) delete next[key];
  return next as SceneDeviceConfig;
}
export function validateSceneDraft(scene: Scene): FieldError[] {
  const errors: FieldError[] = [];
  if (!scene.name.trim())
    errors.push({ field: 'name', message: 'Give this scene a name.' });
  if (!scene.id.trim())
    errors.push({ field: 'id', message: 'Choose a scene ID.' });
  for (const map of ['group_states', 'device_states'] as const)
    for (const [key, target] of Object.entries(scene[map])) {
      const path = `${map}/${key}`;
      if ('scene_id' in target && !target.scene_id)
        errors.push({
          field: path,
          message: `Choose a source scene for ${key}.`,
        });
      if (
        'integration_id' in target &&
        (!target.integration_id || !target.device_id)
      )
        errors.push({
          field: path,
          message: `Choose a source device for ${key}.`,
        });
      if (
        'brightness' in target &&
        target.brightness != null &&
        (!Number.isFinite(target.brightness) ||
          target.brightness < 0 ||
          (!('integration_id' in target) && target.brightness > 1))
      )
        errors.push({
          field: `${path}/brightness`,
          message: `Brightness for ${key} must be ${'integration_id' in target ? 'a nonnegative multiplier' : 'between 0 and 100%'}.`,
        });
      if (
        'transition' in target &&
        target.transition != null &&
        (!Number.isFinite(target.transition) || target.transition < 0)
      )
        errors.push({
          field: `${path}/transition`,
          message: `Fade time for ${key} must be zero or greater.`,
        });
      if ('color' in target && target.color) {
        const color = target.color;
        const valid =
          'h' in color
            ? Number.isFinite(color.h) &&
              color.h >= 0 &&
              color.h <= 360 &&
              Number.isFinite(color.s) &&
              color.s >= 0 &&
              color.s <= 1
            : 'ct' in color
              ? Number.isFinite(color.ct) && color.ct > 0
              : 'r' in color
                ? [color.r, color.g, color.b].every(
                    (value) =>
                      Number.isFinite(value) && value >= 0 && value <= 255,
                  )
                : 'x' in color
                  ? [color.x, color.y].every(
                      (value) =>
                        Number.isFinite(value) && value >= 0 && value <= 1,
                    )
                  : false;
        if (!valid)
          errors.push({
            field: `${path}/color`,
            message: `Check the color values for ${key}.`,
          });
      }
    }
  return errors;
}
export function explicitTarget(
  config: SceneDeviceConfig,
): config is SceneDeviceState {
  return !('scene_id' in config) && !('integration_id' in config);
}
