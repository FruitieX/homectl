/**
 * Pure helpers for scene targets: what a target sets or follows, whether it can
 * still be resolved, and how targets are ordered and counted. Kept free of UI
 * imports so the detail page, the list cards, and tests share one description.
 */

export type SceneTargetKind = 'device' | 'group';

export type SceneTargetMode = 'state' | 'device-link' | 'scene-link';

export type SceneTargetDescriptor = {
  key: string;
  kind: SceneTargetKind;
  mode: SceneTargetMode;
  /** Plain-language summary of what this target sets or follows. */
  summary: string;
  /** Precise reason when the target cannot be resolved, otherwise null. */
  unresolvedReason: string | null;
};

/**
 * Target configs are generated interface types without index signatures, so
 * reads go through these helpers instead of a Record<string, unknown> parameter
 * type that would reject them.
 */
type Config = object;

function read(config: Config, field: string): unknown {
  return (config as Record<string, unknown>)[field];
}

function hasField(config: Config, field: string): boolean {
  return field in config;
}

function hasString(config: Config, field: string): boolean {
  const value = read(config, field);
  return typeof value === 'string' && value !== '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function deviceLinkTargetKey(config: Config): string {
  if (!hasString(config, 'integration_id') || !hasString(config, 'device_id')) {
    return '';
  }
  return `${String(read(config, 'integration_id'))}/${String(read(config, 'device_id'))}`;
}

function brightnessText(config: Config): string | null {
  const brightness = read(config, 'brightness');
  if (typeof brightness !== 'number') return null;
  return `${Math.round(brightness * 100)}% brightness`;
}

export function sceneTargetMode(config: Config): SceneTargetMode {
  // Presence of the key decides the shape (the same rule the editors use); an
  // empty value means "not chosen yet", not "a different kind of target".
  if (hasField(config, 'scene_id')) return 'scene-link';
  if (hasField(config, 'integration_id')) return 'device-link';
  return 'state';
}

/** Mirrors the words a person would use for a target row. */
export function describeSceneTarget(
  key: string,
  { kind }: { kind: SceneTargetKind },
  config: Config,
  context: { sceneIds?: string[]; deviceKeys?: string[] } = {},
): SceneTargetDescriptor {
  const mode = sceneTargetMode(config);

  if (mode === 'scene-link') {
    const sceneId = String(read(config, 'scene_id') ?? '');
    const scope: string[] = [];
    const deviceKeys = asArray(read(config, 'device_keys'));
    const groupKeys = asArray(read(config, 'group_keys'));
    if (deviceKeys.length > 0) {
      scope.push(`${deviceKeys.length} device${deviceKeys.length === 1 ? '' : 's'}`);
    }
    if (groupKeys.length > 0) {
      scope.push(`${groupKeys.length} room${groupKeys.length === 1 ? '' : 's'}`);
    }
    const summary = `Follows scene "${sceneId}"${scope.length > 0 ? ` for ${scope.join(', ')}` : ''}`;
    const known = context.sceneIds
      ? context.sceneIds.includes(sceneId)
      : undefined;

    return {
      key,
      kind,
      mode,
      summary,
      unresolvedReason:
        sceneId === ''
          ? 'Links to a scene that is not chosen yet'
          : known === false
            ? `Links to scene "${sceneId}", which no longer exists`
            : null,
    };
  }

  if (mode === 'device-link') {
    const targetKey = deviceLinkTargetKey(config);
    const brightness = brightnessText(config);
    const summary = `Tracks ${targetKey || 'an unchosen device'}${brightness ? ` · ${brightness}` : ''}`;
    const known = context.deviceKeys
      ? context.deviceKeys.includes(targetKey)
      : undefined;

    return {
      key,
      kind,
      mode,
      summary,
      unresolvedReason:
        targetKey === ''
          ? 'Tracks a device that is not chosen yet'
          : known === false
            ? `Tracks ${targetKey}, which no longer exists`
            : null,
    };
  }

  const parts: string[] = [];
  const power = read(config, 'power');
  if (typeof power === 'boolean') parts.push(power ? 'On' : 'Off');
  const brightness = brightnessText(config);
  if (brightness) parts.push(brightness);
  if (read(config, 'color')) parts.push('Color set');
  const transition = read(config, 'transition');
  if (typeof transition === 'number') {
    parts.push(`${transition}s transition`);
  }

  return {
    key,
    kind,
    mode,
    summary: parts.join(' · ') || 'No state set',
    unresolvedReason: parts.length === 0 ? 'Has no state set yet' : null,
  };
}

/**
 * Saved order first, then anything the order does not mention, in insertion
 * order — the same precedence the engine applies when it walks room targets.
 */
export function orderedSceneTargets<T extends object>(
  items: Record<string, T>,
  order?: readonly string[],
): [string, T][] {
  const ordered = (order ?? []).filter((key) => key in items);
  const rest = Object.keys(items).filter((key) => !ordered.includes(key));
  return [...ordered, ...rest].map((key) => [key, items[key]] as [string, T]);
}

export function sceneTargetsSummary<T extends object>(
  scene: {
    script?: string | null;
    device_states?: Record<string, T>;
    group_states?: Record<string, T>;
    group_state_order?: readonly string[];
  },
  context: { sceneIds?: string[]; deviceKeys?: string[] } = {},
): {
  deviceCount: number;
  groupCount: number;
  total: number;
  unresolvedCount: number;
  scripted: boolean;
} {
  const devices = Object.entries(scene.device_states ?? {}).map(([key, config]) =>
    describeSceneTarget(key, { kind: 'device' }, config, context),
  );
  const groups = Object.entries(scene.group_states ?? {}).map(([key, config]) =>
    describeSceneTarget(key, { kind: 'group' }, config, context),
  );
  const unresolvedCount = [...devices, ...groups].filter(
    (target) => target.unresolvedReason !== null,
  ).length;

  return {
    deviceCount: devices.length,
    groupCount: groups.length,
    total: devices.length + groups.length,
    unresolvedCount,
    scripted: Boolean(scene.script && scene.script.trim() !== ''),
  };
}