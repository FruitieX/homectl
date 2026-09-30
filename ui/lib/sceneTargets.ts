/**
 * Pure helpers for scene targets: what a target sets or follows, whether it can
 * still be resolved, and how targets are ordered and counted. Kept free of UI
 * imports so the detail page, the list cards, and tests share one description.
 */

export type SceneTargetKind = 'device' | 'group';

export type SceneTargetMode =
  'state' | 'device-link' | 'scene-link' | 'unsupported';

/** Raw scene JSON can outlive the editor/schema that produced it. */
export function sceneTargetIssue(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'The saved target is not a state or link object.';
  const v = value as Record<string, unknown>;
  if ('integration_id' in v && 'scene_id' in v)
    return 'The saved target contains both a device link and a scene link.';
  for (const field of [
    'integration_id',
    'device_id',
    'scene_id',
    'mirror_from_group',
  ])
    if (
      (field === 'mirror_from_group' ? v[field] != null : field in v) &&
      typeof v[field] !== 'string'
    )
      return `The saved ${field} is not text.`;
  for (const field of ['power', 'use_scene_transition'])
    if (
      (field === 'use_scene_transition' ? field in v : v[field] != null) &&
      typeof v[field] !== 'boolean'
    )
      return `The saved ${field} is not a boolean.`;
  for (const field of ['brightness', 'transition'])
    if (v[field] != null && typeof v[field] !== 'number')
      return `The saved ${field} is not a number.`;
  for (const field of ['device_keys', 'group_keys'])
    if (
      v[field] != null &&
      (!Array.isArray(v[field]) ||
        !v[field].every((key) => typeof key === 'string'))
    )
      return `The saved ${field} is not a list of IDs.`;
  if (v.color != null) {
    if (typeof v.color !== 'object' || Array.isArray(v.color))
      return 'The saved color is not a supported color object.';
    const color = v.color as Record<string, unknown>;
    const channels =
      'h' in color
        ? ['h', 's']
        : 'ct' in color
          ? ['ct']
          : 'r' in color
            ? ['r', 'g', 'b']
            : 'x' in color
              ? ['x', 'y']
              : [];
    if (
      !channels.length ||
      channels.some(
        (key) => typeof color[key] !== 'number' || !Number.isFinite(color[key]),
      )
    )
      return 'The saved color has unknown or incomplete channels.';
  }
  return null;
}

export type SceneTargetDescriptor = {
  key: string;
  kind: SceneTargetKind;
  mode: SceneTargetMode;
  /** Plain-language summary of what this target sets or follows. */
  summary: string;
  /** Precise reason when the target cannot be resolved, otherwise null. */
  unresolvedReason: string | null;
  /**
   * Set when the saved reference resolves through an integration alias — the
   * device id still exists in the catalog under another integration id.
   */
  resolvedKey?: string | null;
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

export type DeviceLinkResolution =
  | { state: 'known' }
  | { state: 'aliased'; resolvedKey: string }
  | { state: 'missing' }
  | { state: 'unknown' };

/**
 * A saved device link can keep working after the integration id changes: the
 * server still serves an old `circadian/color` reference from the device that
 * is now published as `computed/circadian`. So a literal key miss is not proof
 * that the device is gone — only an explicitly declared alias can resolve it
 * through another integration; matching a device ID alone is insufficient. Callers pass the
 * catalog only once it has loaded; while it is loading the answer is
 * 'unknown', never 'missing'.
 */
export function resolveDeviceLink(
  targetKey: string,
  deviceKeys?: string[],
  aliases?: Record<string, string>,
): DeviceLinkResolution {
  if (!deviceKeys) return { state: 'unknown' };
  if (deviceKeys.includes(targetKey)) return { state: 'known' };
  const canonical = aliases?.[targetKey];
  return canonical && deviceKeys.includes(canonical)
    ? { state: 'aliased', resolvedKey: canonical }
    : { state: 'missing' };
}

/** `alias -> computed/<source id>` for every source that declares legacy keys. */
export function sourceAliasKeys(
  sources: Array<{ id: string; aliases?: Array<string> }> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const source of sources ?? []) {
    for (const alias of source.aliases ?? []) {
      map[alias] = `computed/${source.id}`;
    }
  }
  return map;
}

/** One sentence for the expanded target: why the saved key still works. */
export function deviceLinkAliasNote(
  savedKey: string,
  resolvedKey: string,
): string {
  return `Saved as ${savedKey}; the same device is published as ${resolvedKey}.`;
}

function brightnessText(config: Config): string | null {
  const brightness = read(config, 'brightness');
  if (typeof brightness !== 'number') return null;
  return `${Math.round(brightness * 100)}% brightness`;
}

export function sceneTargetMode(config: unknown): SceneTargetMode {
  if (sceneTargetIssue(config)) return 'unsupported';
  // Presence of the key decides the shape (the same rule the editors use); an
  // empty value means "not chosen yet", not "a different kind of target".
  if (hasField(config as Config, 'scene_id')) return 'scene-link';
  if (hasField(config as Config, 'integration_id')) return 'device-link';
  return 'state';
}

/** Mirrors the words a person would use for a target row. */
export function describeSceneTarget(
  key: string,
  { kind }: { kind: SceneTargetKind },
  config: Config,
  context: {
    sceneIds?: string[];
    deviceKeys?: string[];
    aliases?: Record<string, string>;
  } = {},
): SceneTargetDescriptor {
  const mode = sceneTargetMode(config);
  if (mode === 'unsupported')
    return {
      key,
      kind,
      mode,
      summary: 'Saved target needs review',
      unresolvedReason: sceneTargetIssue(config),
    };

  if (mode === 'scene-link') {
    const sceneId = String(read(config, 'scene_id') ?? '');
    const scope: string[] = [];
    const deviceKeys = asArray(read(config, 'device_keys'));
    const groupKeys = asArray(read(config, 'group_keys'));
    if (deviceKeys.length > 0) {
      scope.push(
        `${deviceKeys.length} device${deviceKeys.length === 1 ? '' : 's'}`,
      );
    }
    if (groupKeys.length > 0) {
      scope.push(
        `${groupKeys.length} room${groupKeys.length === 1 ? '' : 's'}`,
      );
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
    const resolution = resolveDeviceLink(
      targetKey,
      context.deviceKeys,
      context.aliases,
    );

    return {
      key,
      kind,
      mode,
      summary,
      unresolvedReason:
        targetKey === ''
          ? 'Tracks a device that is not chosen yet'
          : resolution.state === 'missing'
            ? `Tracks ${targetKey}, which no longer exists`
            : null,
      resolvedKey:
        resolution.state === 'aliased' ? resolution.resolvedKey : null,
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
    summary:
      parts.join(' · ') || 'On · default brightness · color not specified',
    unresolvedReason: null,
  };
}

/**
 * Saved order first, then anything the order does not mention, in alphabetical
 * order — the same precedence the engine applies when it walks room targets.
 */
export function orderedSceneTargets<T extends object>(
  items: Record<string, T>,
  order?: readonly string[],
): [string, T][] {
  const ordered = [...new Set((order ?? []).filter((key) => key in items))];
  const rest = Object.keys(items)
    .filter((key) => !ordered.includes(key))
    .sort();
  return [...ordered, ...rest].map((key) => [key, items[key]] as [string, T]);
}

export function sceneTargetsSummary<T extends object>(
  scene: {
    script?: string | null;
    device_states?: Record<string, T>;
    group_states?: Record<string, T>;
    group_state_order?: readonly string[];
  },
  context: {
    sceneIds?: string[];
    deviceKeys?: string[];
    aliases?: Record<string, string>;
  } = {},
): {
  deviceCount: number;
  groupCount: number;
  total: number;
  unresolvedCount: number;
  scripted: boolean;
} {
  const devices = Object.entries(scene.device_states ?? {}).map(
    ([key, config]) =>
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
