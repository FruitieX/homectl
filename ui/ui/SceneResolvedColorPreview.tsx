import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import {
  Scene,
  SceneDeviceConfig,
  getSceneDeviceLinkTargetKey,
} from '@/hooks/useConfig';
import { black, getResolvedDeviceColorState, white } from '@/lib/colors';
import {
  type DeviceColor,
  type RawDeviceColor,
  colorToRgb,
  getColorMode,
} from '@/lib/deviceColor';
import Color, { type ColorInstance } from 'color';

type Color = ColorInstance;

export type SceneTargetKind = 'device' | 'group';

type WrappedColor = {
  Hs?: { h: number; s: number };
  Xy?: { x: number; y: number };
  Rgb?: { r: number; g: number; b: number };
  Ct?: { ct: number };
};

type PlainColor =
  | { h: number; s: number }
  | { x: number; y: number }
  | { r: number; g: number; b: number }
  | { ct: number };

type ColorInput = WrappedColor | PlainColor | null | undefined;

export type ResolvedSceneColor = {
  color: Color;
  isPowered: boolean;
  sourceLabel: string;
};

const previewDotClassName =
  'inline-flex h-4 w-4 shrink-0 rounded-full border border-foreground/15 shadow-inner';

function clampBrightness(value: number) {
  return Math.max(0, Math.min(1, value));
}

function applyBrightness(color: Color, brightness: number) {
  return color.mix(black, 1 - clampBrightness(brightness));
}

export function ResolvedColorDot({
  color,
  isPowered,
  className = previewDotClassName,
  label,
  detail,
}: {
  color: Color;
  isPowered: boolean;
  className?: string;
  /** Accessible name, e.g. “warm white”. The dot alone conveys nothing. */
  label?: string;
  /** Exact colour for the tooltip, e.g. “h 32° s 40% · #ffb066”. */
  detail?: string;
}) {
  return (
    <span
      className={className}
      role="img"
      aria-label={label}
      title={detail ?? label}
      style={{
        backgroundColor: color.hex(),
        opacity: isPowered ? 1 : 0.45,
      }}
    />
  );
}

function getColorObject(color: ColorInput): Color | null {
  if (!color || typeof color !== 'object') return null;
  if (!getColorMode(color as RawDeviceColor)) return null;
  const { r, g, b } = colorToRgb(color as DeviceColor);
  return Color.rgb(r, g, b);
}

function getSceneById(scenes: Scene[], sceneId: string) {
  return scenes.find((scene) => scene.id === sceneId);
}

function getSceneTargetConfig(
  scene: Scene,
  targetKind: SceneTargetKind,
  targetKey: string,
) {
  return targetKind === 'device'
    ? scene.device_states?.[targetKey]
    : scene.group_states?.[targetKey];
}

function getLinkedDeviceColor(
  device: Device | undefined,
): ResolvedSceneColor | null {
  if (!device) {
    return null;
  }

  const resolved = getResolvedDeviceColorState(device.data);
  if (!resolved) {
    return null;
  }

  return {
    color: applyBrightness(resolved.color, resolved.brightness),
    isPowered: resolved.power,
    sourceLabel: 'Resolved from linked device',
  };
}

function getConfiguredStateColor(
  config: SceneDeviceConfig,
): ResolvedSceneColor | null {
  if ('scene_id' in config || 'integration_id' in config) {
    return null;
  }

  const brightness = clampBrightness(
    typeof config.brightness === 'number'
      ? config.brightness
      : config.power === false
        ? 0
        : 1,
  );
  const color =
    getColorObject(config.color) ??
    (brightness > 0 || config.power ? white : null);

  if (!color) {
    return null;
  }

  return {
    color: applyBrightness(color, brightness),
    isPowered: config.power ?? brightness > 0,
    sourceLabel: config.color ? 'Configured color' : 'Configured brightness',
  };
}

export function resolveSceneColor(
  config: SceneDeviceConfig,
  targetKind: SceneTargetKind,
  targetKey: string,
  scenes: Scene[],
  devices: DevicesState,
  visitedSceneTargets = new Set<string>(),
): ResolvedSceneColor | null {
  if ('integration_id' in config) {
    const linkedDeviceKey = getSceneDeviceLinkTargetKey(config);
    return getLinkedDeviceColor(
      linkedDeviceKey ? devices[linkedDeviceKey] : undefined,
    );
  }

  if ('scene_id' in config) {
    const visitedKey = `${config.scene_id}:${targetKind}:${targetKey}`;
    if (visitedSceneTargets.has(visitedKey)) {
      return null;
    }

    if (
      targetKind === 'device' &&
      config.device_keys?.length &&
      !config.device_keys.includes(targetKey)
    ) {
      return null;
    }

    if (
      targetKind === 'group' &&
      config.group_keys?.length &&
      !config.group_keys.includes(targetKey)
    ) {
      return null;
    }

    const linkedScene = getSceneById(scenes, config.scene_id);
    if (!linkedScene) {
      return null;
    }

    const linkedConfig = getSceneTargetConfig(
      linkedScene,
      targetKind,
      targetKey,
    );
    if (!linkedConfig) {
      return null;
    }

    const nextVisitedSceneTargets = new Set(visitedSceneTargets);
    nextVisitedSceneTargets.add(visitedKey);

    const resolved = resolveSceneColor(
      linkedConfig,
      targetKind,
      targetKey,
      scenes,
      devices,
      nextVisitedSceneTargets,
    );

    if (!resolved) {
      return null;
    }

    return {
      ...resolved,
      sourceLabel: 'Resolved from linked scene',
    };
  }

  return getConfiguredStateColor(config);
}

export function SceneResolvedColorPreview({
  config,
  devices,
  scenes,
  targetKey,
  targetKind,
}: {
  config: SceneDeviceConfig;
  devices: DevicesState;
  scenes: Scene[];
  targetKey: string;
  targetKind: SceneTargetKind;
}) {
  const resolved = resolveSceneColor(
    config,
    targetKind,
    targetKey,
    scenes,
    devices,
  );

  if (!resolved) {
    return null;
  }

  return (
    <div className="mt-3 flex items-center gap-2 text-xs opacity-75">
      <ResolvedColorDot color={resolved.color} isPowered={resolved.isPowered} />
      <span>{resolved.sourceLabel}</span>
      {!resolved.isPowered && <span className="opacity-60">device off</span>}
    </div>
  );
}
