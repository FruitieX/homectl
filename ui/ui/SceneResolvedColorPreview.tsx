import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import {
  Scene,
  SceneDeviceConfig,
  getSceneDeviceLinkTargetKey,
} from '@/hooks/useConfig';
import { black, getResolvedDeviceColorState, white } from '@/lib/colors';
import Color from 'color';

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
  'inline-flex h-4 w-4 shrink-0 rounded-full border border-base-content/15 shadow-inner';

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
}: {
  color: Color;
  isPowered: boolean;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        backgroundColor: color.hex(),
        opacity: isPowered ? 1 : 0.45,
      }}
    />
  );
}

function xyToRgb(x: number, y: number) {
  const safeY = y === 0 ? 0.0001 : y;
  const z = 1 - x - y;
  const brightness = 1;
  const linearX = (brightness / safeY) * x;
  const linearZ = (brightness / safeY) * z;

  let r = linearX * 1.656492 - brightness * 0.354851 - linearZ * 0.255038;
  let g = -linearX * 0.707196 + brightness * 1.655397 + linearZ * 0.036152;
  let b = linearX * 0.051713 - brightness * 0.121364 + linearZ * 1.01153;

  r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(r, 1 / 2.4) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(g, 1 / 2.4) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : 1.055 * Math.pow(b, 1 / 2.4) - 0.055;

  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));

  return {
    r: clamp(r),
    g: clamp(g),
    b: clamp(b),
  };
}

function getColorObject(color: ColorInput): Color | null {
  if (!color || typeof color !== 'object') {
    return null;
  }

  if ('Hs' in color && color.Hs) {
    return Color({ h: color.Hs.h, s: color.Hs.s * 100, v: 100 });
  }
  if ('Rgb' in color && color.Rgb) {
    return Color.rgb(color.Rgb.r, color.Rgb.g, color.Rgb.b);
  }
  if ('Ct' in color && color.Ct) {
    const normalized = Math.max(0, Math.min(1, (color.Ct.ct - 153) / (500 - 153)));
    return Color.rgb(
      Math.round(255 - normalized * 55),
      Math.round(240 - normalized * 30),
      Math.round(200 + normalized * 55),
    );
  }
  if ('Xy' in color && color.Xy) {
    const rgb = xyToRgb(color.Xy.x, color.Xy.y);
    return Color.rgb(rgb.r, rgb.g, rgb.b);
  }

  if ('h' in color && 's' in color) {
    return Color({ h: color.h, s: color.s * 100, v: 100 });
  }
  if ('r' in color && 'g' in color && 'b' in color) {
    return Color.rgb(color.r, color.g, color.b);
  }
  if ('ct' in color) {
    const normalized = Math.max(0, Math.min(1, (color.ct - 153) / (500 - 153)));
    return Color.rgb(
      Math.round(255 - normalized * 55),
      Math.round(240 - normalized * 30),
      Math.round(200 + normalized * 55),
    );
  }
  if ('x' in color && 'y' in color) {
    const rgb = xyToRgb(color.x, color.y);
    return Color.rgb(rgb.r, rgb.g, rgb.b);
  }

  return null;
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

function getLinkedDeviceColor(device: Device | undefined): ResolvedSceneColor | null {
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

function getConfiguredStateColor(config: SceneDeviceConfig): ResolvedSceneColor | null {
  if ('scene_id' in config || 'integration_id' in config) {
    return null;
  }

  const brightness = clampBrightness(
    typeof config.brightness === 'number' ? config.brightness : config.power === false ? 0 : 1,
  );
  const color = getColorObject(config.color) ?? (brightness > 0 || config.power ? white : null);

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
    return getLinkedDeviceColor(linkedDeviceKey ? devices[linkedDeviceKey] : undefined);
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

    const linkedConfig = getSceneTargetConfig(linkedScene, targetKind, targetKey);
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
  const resolved = resolveSceneColor(config, targetKind, targetKey, scenes, devices);

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