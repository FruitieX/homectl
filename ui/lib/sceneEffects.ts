/**
 * What activating a scene actually does, device by device.
 *
 * A target row answers “what will change”, not “which names are configured”:
 * the engine applies room targets first, then device targets, and a later
 * target overwrites the state an earlier one contributed, so this module
 * resolves the final effect per device and says which target won.
 */

import { resolveDeviceLink } from './sceneTargets.ts';

export type SceneEffectTargetKind = 'device' | 'group' | 'scene';

type Config = object;

function read(config: Config | null | undefined, field: string): unknown {
  return config ? (config as Record<string, unknown>)[field] : undefined;
}

function has(config: Config | null | undefined, field: string): boolean {
  return config ? field in (config as Record<string, unknown>) : false;
}

export type SceneDeviceStateWords = {
  /** Effect phrases in the order a person reads them: on, 80%, warm white. */
  changes: string[];
  /** True when the target sets nothing a device could apply. */
  empty: boolean;
};

/** Hue bands for naming a colour the way a person would. */
const HUE_BANDS: Array<[number, string]> = [
  [12, 'red'],
  [32, 'orange'],
  [52, 'amber'],
  [70, 'yellow'],
  [100, 'lime'],
  [160, 'green'],
  [200, 'teal'],
  [230, 'cyan'],
  [265, 'blue'],
  [300, 'indigo'],
  [330, 'purple'],
  [352, 'pink'],
  [360, 'red'],
];

/** “warm white”, “cool white”, “blue” — never a raw hue number. */
export function describeColorWords(color: unknown): string | null {
  if (!color || typeof color !== 'object') {
    return null;
  }
  const h = read(color, 'h');
  const s = read(color, 's');
  if (typeof h !== 'number' || typeof s !== 'number') {
    return null;
  }
  if (s < 0.45) {
    if (h <= 90 || h >= 300) return 'warm white';
    return 'cool white';
  }
  const band = HUE_BANDS.find(([limit]) => h <= limit);
  return band ? band[1] : 'coloured';
}

/**
 * The state words for one target config. Order follows how a person thinks
 * about the change: on or off first, then brightness, then colour, then fade.
 */
export function describeSceneStateWords(
  config: Config | null | undefined,
): SceneDeviceStateWords {
  const changes: string[] = [];
  const power = read(config, 'power');
  if (typeof power === 'boolean') {
    changes.push(power ? 'on' : 'off');
  }
  const brightness = read(config, 'brightness');
  if (typeof brightness === 'number') {
    changes.push(`${Math.round(brightness * 100)}%`);
  }
  const colorWords = describeColorWords(read(config, 'color'));
  if (colorWords) {
    changes.push(colorWords);
  }
  const transition = read(config, 'transition');
  if (typeof transition === 'number' && transition > 0) {
    changes.push(`${transition} s fade`);
  }
  return { changes, empty: changes.length === 0 };
}

export type SceneEffectMode = 'state' | 'device-link' | 'scene-link';

export type SceneResolvedColor = { h: number; s: number };

/**
 * The same state split into a form the UI can render: words for on/brightness/
 * fade, and the colour as a value so a swatch comes from what the scene sets
 * rather than from parsing the words back out.
 */
export function describeSceneStateParts(config: Config | null | undefined): {
  changes: string[];
  colorWords: string | null;
  color: SceneResolvedColor | null;
  empty: boolean;
} {
  const changes: string[] = [];
  const power = read(config, 'power');
  if (typeof power === 'boolean') {
    changes.push(power ? 'on' : 'off');
  }
  const brightness = read(config, 'brightness');
  if (typeof brightness === 'number') {
    changes.push(`${Math.round(brightness * 100)}%`);
  }
  const colorWords = describeColorWords(read(config, 'color'));
  const transition = read(config, 'transition');
  if (typeof transition === 'number' && transition > 0) {
    changes.push(`${transition} s fade`);
  }
  const raw = read(config, 'color');
  const color =
    raw && typeof raw === 'object' && 'h' in raw && 's' in raw
      ? {
          h: Number((raw as { h: unknown }).h),
          s: Number((raw as { s: unknown }).s),
        }
      : null;
  return {
    changes,
    colorWords,
    color:
      color && Number.isFinite(color.h) && Number.isFinite(color.s)
        ? color
        : null,
    empty: changes.length === 0 && colorWords === null,
  };
}

export type SceneEffectDevice = {
  deviceKey: string;
  deviceLabel: string;
  changes: string[];
  /** What the target sets, as a value, so a swatch needs no text parsing. */
  color: SceneResolvedColor | null;
  colorWords: string | null;
  /** Set when a later target replaced this device's effect. */
  overriddenBy?: string;
};

export type SceneEffectTarget = {
  /** Set when a saved device link resolves through an integration alias. */
  resolvedKey?: string | null;
  key: string;
  kind: SceneEffectTargetKind;
  label: string;
  mode: SceneEffectMode;
  /** Why this target cannot be applied at all, otherwise null. */
  unresolvedReason: string | null;
  /** What the user can do about it, phrased as an action. */
  repair: string | null;
  /** Devices this target changes, already expanded for rooms. */
  devices: SceneEffectDevice[];
  /** Saved members of this room that are not in the current catalog. */
  missingMembers: string[];
};

export type SceneEffects = {
  targets: SceneEffectTarget[];
  /** Final effect per device after ordering; the last writer wins. */
  finalByDevice: Array<{
    deviceKey: string;
    deviceLabel: string;
    changes: string[];
    color: SceneResolvedColor | null;
    colorWords: string | null;
    fromLabel: string;
  }>;
  affectedDeviceCount: number;
  unresolvedCount: number;
  /** Missing references split by where they live, for an honest header. */
  unresolvedByKind: {
    directTargets: number;
    roomTargets: number;
    roomMembers: number;
  };
  /** True when the scene has a script that can override these values. */
  scripted: boolean;
  /** Devices that a room target sets but a device target then overrides. */
  overrideNotes: string[];
};

type DeviceLike = { name?: string };

export type SceneEffectsContext = {
  devices?: Record<string, DeviceLike>;
  groups?: Record<string, { name?: string; device_keys?: unknown[] }>;
  scenes?: Array<{ id: string; name: string }>;
  /** Room targets the engine walks first (saved order). */
  groupOrder?: readonly string[];
  deviceDisplayNames?: Record<string, string>;
  /** Legacy device keys a computed source still answers to. */
  sourceAliases?: Record<string, string>;
  /** Follows a scene link when a target reads another scene. */
  resolveSceneLink?: (
    sceneId: string,
  ) => { device_states?: Record<string, Config> } | undefined;
};

function labelFor(
  key: string,
  context: SceneEffectsContext,
  fallback: string,
): string {
  const name = context.devices?.[key]?.name;
  if (name) {
    return name;
  }
  const override = context.deviceDisplayNames?.[key];
  if (override) {
    return override;
  }
  const sceneKey = key.startsWith('computed/')
    ? key.slice('computed/'.length)
    : '';
  if (sceneKey) {
    const source = context.scenes?.find((scene) => scene.id === sceneKey);
    if (source) {
      return `Computed · ${source.name}`;
    }
  }
  return fallback || key;
}

function groupLabel(key: string, context: SceneEffectsContext): string {
  return context.groups?.[key]?.name ?? key;
}

function memberKeys(key: string, context: SceneEffectsContext): string[] {
  const raw = context.groups?.[key]?.device_keys ?? [];
  return raw.map((entry) => String(entry));
}

/**
 * Resolve what the scene would do: room targets first, then device targets,
 * with the last writer per device winning.
 */
export function resolveSceneEffects(
  scene: {
    device_states?: Record<string, Config> | null;
    group_states?: Record<string, Config> | null;
    group_state_order?: readonly string[] | null;
    script?: string | null;
  },
  context: SceneEffectsContext = {},
): SceneEffects {
  const targets: SceneEffectTarget[] = [];
  const written = new Map<
    string,
    { targetIndex: number; deviceIndex: number }
  >();

  const groupEntries = Object.entries(scene.group_states ?? {});
  const ordered = [
    ...(scene.group_state_order ?? []).filter((key) =>
      groupEntries.some(([entryKey]) => entryKey === key),
    ),
    ...groupEntries
      .map(([key]) => key)
      .filter((key) => !(scene.group_state_order ?? []).includes(key)),
  ];

  const pushTarget = (
    key: string,
    kind: SceneEffectTargetKind,
    config: Config | undefined,
  ) => {
    const mode: SceneEffectMode = has(config, 'scene_id')
      ? 'scene-link'
      : has(config, 'integration_id')
        ? 'device-link'
        : 'state';

    const target: SceneEffectTarget = {
      key,
      kind,
      label:
        kind === 'group'
          ? groupLabel(key, context)
          : labelFor(key, context, key),
      mode,
      unresolvedReason: null,
      repair: null,
      devices: [],
      missingMembers: [],
    };

    if (kind === 'group' && !context.groups?.[key]) {
      target.unresolvedReason = `This room no longer exists`;
      target.repair = 'Pick another room, or remove this target.';
      targets.push(target);
      return;
    }

    if (mode === 'scene-link') {
      const sceneId = String(read(config, 'scene_id') ?? '');
      const linked = context.resolveSceneLink?.(sceneId);
      if (!sceneId || !linked) {
        target.unresolvedReason = sceneId
          ? `It follows scene “${sceneId}”, which no longer exists`
          : 'It does not follow a scene yet';
        target.repair = 'Pick an existing scene, or remove this target.';
      }
      // Scoped followers only touch their listed devices; the summary says so
      // without pretending to know the values that scene will write.
      const listed = (read(config, 'device_keys') ?? []) as unknown[];
      for (const entry of listed) {
        const deviceKey = String(entry);
        target.devices.push({
          deviceKey,
          deviceLabel: labelFor(deviceKey, context, deviceKey),
          changes: [`follows “${sceneId}”`],
          color: null,
          colorWords: null,
        });
      }
      targets.push(target);
      return;
    }

    if (mode === 'device-link') {
      const sourceKey = `${String(read(config, 'integration_id'))}/${String(
        read(config, 'device_id'),
      )}`;
      // A saved reference can outlive an integration rename (the server keeps
      // serving `circadian/color` from `computed/circadian`), so a literal key
      // miss is only a problem when the device id is gone from the catalog too.
      const resolution = resolveDeviceLink(
        sourceKey,
        context.devices ? Object.keys(context.devices) : undefined,
        context.sourceAliases,
      );
      if (resolution.state === 'missing') {
        target.unresolvedReason = `It tracks ${sourceKey}, which is not available`;
        target.repair = 'Choose another source device, or remove this target.';
      } else if (resolution.state === 'aliased') {
        target.resolvedKey = resolution.resolvedKey;
      }
      const words = describeSceneStateParts(config);
      const deviceKey = kind === 'group' ? `group:${key}` : key;
      target.devices.push({
        deviceKey,
        deviceLabel:
          kind === 'group'
            ? `${memberKeys(key, context).length} device${
                memberKeys(key, context).length === 1 ? '' : 's'
              } follow it`
            : labelFor(key, context, key),
        changes:
          words.changes.length > 0 ? words.changes : ['tracks the source'],
        color: null,
        colorWords: null,
      });
      targets.push(target);
      return;
    }

    const words = describeSceneStateParts(config);
    if (words.empty) {
      target.unresolvedReason = 'It sets no state yet';
      target.repair = 'Choose what this target should set, or remove it.';
      targets.push(target);
      return;
    }

    if (kind === 'group') {
      const members = memberKeys(key, context);
      if (members.length === 0) {
        target.unresolvedReason = 'This room has no devices right now';
        target.repair = 'Add devices to the room, or remove this target.';
      }
      const index = targets.length;
      for (const deviceKey of members) {
        if (!context.devices?.[deviceKey]) {
          // A saved member that is not in the catalog: name it instead of
          // pretending the room will change it.
          target.missingMembers.push(deviceKey);
          continue;
        }
        const previous = written.get(deviceKey);
        if (previous) {
          const earlier =
            targets[previous.targetIndex].devices[previous.deviceIndex];
          if (earlier) {
            earlier.overriddenBy = `the target for ${labelFor(deviceKey, context, deviceKey)} below`;
          }
        }
        target.devices.push({
          deviceKey,
          deviceLabel: labelFor(deviceKey, context, deviceKey),
          changes: words.changes,
          color: words.color,
          colorWords: words.colorWords,
        });
        written.set(deviceKey, {
          targetIndex: index,
          deviceIndex: target.devices.length - 1,
        });
      }
      targets.push(target);
      return;
    }

    // A device target: the device may or may not still exist.
    if (!context.devices?.[key]) {
      target.unresolvedReason = `This device is not available right now`;
      target.repair = 'Choose another device, or remove this target.';
    }
    const index = targets.length;
    const previous = written.get(key);
    if (previous) {
      const earlier =
        targets[previous.targetIndex].devices[previous.deviceIndex];
      if (earlier) {
        earlier.overriddenBy = 'this device target';
      }
    }
    target.devices.push({
      deviceKey: key,
      deviceLabel: labelFor(key, context, key),
      changes: words.changes,
      color: words.color,
      colorWords: words.colorWords,
    });
    written.set(key, {
      targetIndex: index,
      deviceIndex: target.devices.length - 1,
    });
    targets.push(target);
  };

  for (const key of ordered) {
    pushTarget(key, 'group', scene.group_states?.[key]);
  }
  for (const [key, config] of Object.entries(scene.device_states ?? {})) {
    pushTarget(key, 'device', config);
  }

  // Last writer wins, in the same order the engine walks targets.
  const finalOrder: string[] = [];
  const finalMap = new Map<string, SceneEffects['finalByDevice'][number]>();
  for (const target of targets) {
    if (target.unresolvedReason) {
      continue;
    }
    for (const device of target.devices) {
      if (!finalMap.has(device.deviceKey)) {
        finalOrder.push(device.deviceKey);
      }
      finalMap.set(device.deviceKey, {
        deviceKey: device.deviceKey,
        deviceLabel: device.deviceLabel,
        changes: device.changes,
        color: device.color,
        colorWords: device.colorWords,
        fromLabel: target.label,
      });
    }
  }
  const finalByDevice = finalOrder
    .map((key) => finalMap.get(key))
    .filter((entry): entry is SceneEffects['finalByDevice'][number] =>
      Boolean(entry),
    );

  const overrideNotes: string[] = [];
  for (const target of targets) {
    for (const device of target.devices) {
      if (device.overriddenBy) {
        overrideNotes.push(
          `${device.deviceLabel}: the room setting is overridden by ${device.overriddenBy}`,
        );
      }
    }
  }

  const unresolvedByKind = {
    directTargets: targets.filter(
      (target) => target.kind === 'device' && target.unresolvedReason !== null,
    ).length,
    roomTargets: targets.filter(
      (target) => target.kind === 'group' && target.unresolvedReason !== null,
    ).length,
    roomMembers: targets.reduce(
      (total, target) => total + target.missingMembers.length,
      0,
    ),
  };
  const unresolvedCount =
    targets.filter((target) => target.unresolvedReason !== null).length +
    unresolvedByKind.roomMembers;

  return {
    targets,
    finalByDevice,
    affectedDeviceCount: finalByDevice.length,
    unresolvedCount,
    unresolvedByKind,
    scripted: Boolean(scene.script && scene.script.trim() !== ''),
    overrideNotes,
  };
}
