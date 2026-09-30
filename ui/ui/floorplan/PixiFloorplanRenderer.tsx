import type { LightHold } from '@/lib/lightQuickAdjust';
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';
import { floorplanLabels } from '@/lib/floorplan-labels';
import {
  getGroupLabelLayout,
  GROUP_LABEL_FONT_SIZE,
  GROUP_LABEL_LINE_HEIGHT,
} from '@/lib/floorplan-group-label';
import { getGroupOutline } from '@/lib/floorplan-group-outline';
import {
  type FloorplanScene,
  type FloorplanScenePoint,
  type FloorplanSceneTile,
} from '@/lib/floorplan-scene';

interface PixiFloorplanRendererProps {
  scene: FloorplanScene;
  selectedDeviceKeys?: readonly string[];
  interactive?: boolean;
  fitPadding?: number;
  /**
   * Scene-space rectangle to frame instead of the whole floorplan. Used by
   * group previews to zoom to the group's placed devices.
   */
  focusBounds?: { x: number; y: number; width: number; height: number } | null;
  fitOnResize?: boolean;
  renderLabels?: boolean;
  /** Stop the render ticker while the renderer is offscreen. */
  paused?: boolean;
  onDevicePress?: (deviceKey: string, modifiers?: { ctrlKey: boolean }) => void;
  onDeviceLongPress?: (deviceKey: string) => void;
  onDeviceHold?: (deviceKey: string, hold: LightHold) => void;
  onSensorPress?: (deviceKey: string) => void;
  onSensorHold?: (deviceKey: string, hold: LightHold) => void;
  onGroupPress?: (groupId: string) => void;
  onGroupLongPress?: (groupId: string) => void;
  onUnavailable?: () => void;
  /** The WebGL context was lost; the owner can remount to recover. */
  onContextLost?: () => void;
  className?: string;
}

interface RendererHandlers {
  onDevicePress?: (deviceKey: string, modifiers?: { ctrlKey: boolean }) => void;
  onDeviceLongPress?: (deviceKey: string) => void;
  onDeviceHold?: (deviceKey: string, hold: LightHold) => void;
  onSensorPress?: (deviceKey: string) => void;
  onSensorHold?: (deviceKey: string, hold: LightHold) => void;
  onGroupPress?: (groupId: string) => void;
  onGroupLongPress?: (groupId: string) => void;
  onUnavailable?: () => void;
  onContextLost?: () => void;
}

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

type HitTarget =
  | { type: 'device'; key: string }
  | { type: 'sensor'; key: string }
  | { type: 'group'; key: string };

interface ActiveGesture {
  pointerId: number;
  start: ScreenPoint;
  last: ScreenPoint;
  target: HitTarget | null;
  moved: boolean;
  longPressFired: boolean;
  longPressTimer: ReturnType<typeof setTimeout> | null;
}

interface PinchState {
  center: ScreenPoint;
  distance: number;
}

interface RendererQuality {
  label: 'low' | 'medium' | 'high';
  lightTextureSize: number;
  renderLabels: boolean;
  resolutionCap: number;
}

interface LightRenderEntry {
  sprite: Sprite;
  mask: Graphics | null;
  visibilityPolygon?: FloorplanScenePoint[];
}

interface SensorLabelRenderEntry {
  container: Container;
  label: Text;
  status: Text | null;
}

interface GroupRenderEntry {
  drawKey: string;
  graphics: Graphics;
  outline: Graphics;
  labelBackground: Graphics;
  label: Text;
}

interface SceneRenderState {
  hoveredKey?: string;
  backgroundLayer: Container;
  groupLayer: Container;
  groupOutlineLayer: Container;
  tileLayer: Container;
  lightLayer: Container;
  markerLayer: Container;
  labelLayer: Container;
  backgroundSprite: Sprite | null;
  backgroundImage?: HTMLImageElement;
  tileGraphics: Graphics;
  tileSource: readonly FloorplanSceneTile[] | null;
  groupEntries: Map<string, GroupRenderEntry>;
  lightEntries: Map<string, LightRenderEntry>;
  lightMarkerEntries: Map<string, Graphics>;
  labelTextureScale: number;
  labelViewScale: number;
  sensorMarkerEntries: Map<string, Graphics>;
  sensorLabelEntries: Map<string, SensorLabelRenderEntry>;
}

const emptySelection: readonly string[] = [];
const longPressDelayMs = 500;
const tapMoveTolerancePx = 8;
const minScale = 0.001;
const maxScale = 8;
const labelTextureScaleStep = 0.25;
const lightGradientTextureCache = new Map<number, Texture>();
const objectIdentityCache = new WeakMap<object, number>();
let nextObjectIdentity = 1;

function getObjectIdentity(value: object) {
  const cachedIdentity = objectIdentityCache.get(value);
  if (cachedIdentity !== undefined) {
    return cachedIdentity;
  }

  const identity = nextObjectIdentity;
  nextObjectIdentity += 1;
  objectIdentityCache.set(value, identity);
  return identity;
}

function getRendererQuality(): RendererQuality {
  const memory =
    'deviceMemory' in navigator ? Number(navigator.deviceMemory) : 8;
  const cores = navigator.hardwareConcurrency || 8;
  const touchFirst = window.matchMedia('(pointer: coarse)').matches;

  if (touchFirst && (memory <= 4 || cores <= 4)) {
    return {
      label: 'low',
      lightTextureSize: 192,
      renderLabels: true,
      resolutionCap: 1.25,
    };
  }

  if (touchFirst || memory <= 6 || cores <= 6) {
    return {
      label: 'medium',
      lightTextureSize: 256,
      renderLabels: true,
      resolutionCap: 1.5,
    };
  }

  return {
    label: 'high',
    lightTextureSize: 384,
    renderLabels: true,
    resolutionCap: 2,
  };
}

function rgbToHex(rgb: readonly [number, number, number]) {
  const red = Math.max(0, Math.min(255, Math.round(rgb[0])));
  const green = Math.max(0, Math.min(255, Math.round(rgb[1])));
  const blue = Math.max(0, Math.min(255, Math.round(rgb[2])));

  return (red << 16) + (green << 8) + blue;
}

function srgbToLinear(component: number) {
  const normalized = Math.max(0, Math.min(255, component)) / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(component: number) {
  const clamped = Math.max(0, component);
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, encoded * 255));
}

function toneMapLightColor(
  rgb: readonly [number, number, number],
  intensity: number,
) {
  const exposure = 0.65 + intensity * 0.55;
  const linear = rgb.map((component) => srgbToLinear(component) * exposure);
  const toneMapped = linear.map((component) => component / (1 + component));

  return rgbToHex([
    linearToSrgb(toneMapped[0] ?? 0),
    linearToSrgb(toneMapped[1] ?? 0),
    linearToSrgb(toneMapped[2] ?? 0),
  ]);
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = lightness - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = secondary;
  } else if (huePrime >= 1 && huePrime < 2) {
    red = secondary;
    green = chroma;
  } else if (huePrime >= 2 && huePrime < 3) {
    green = chroma;
    blue = secondary;
  } else if (huePrime >= 3 && huePrime < 4) {
    green = secondary;
    blue = chroma;
  } else if (huePrime >= 4 && huePrime < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  return rgbToHex([
    (red + match) * 255,
    (green + match) * 255,
    (blue + match) * 255,
  ]);
}

function getGroupColor(groupId: string) {
  let hash = 0;
  for (let index = 0; index < groupId.length; index += 1) {
    hash = (hash * 31 + groupId.charCodeAt(index)) % 360;
  }
  return hslToHex(hash, 0.12, 0.42);
}

function getTileColor(tile: FloorplanSceneTile) {
  switch (tile.type) {
    case 'empty':
      return 0x000000;
    case 'wall':
      return 0x334155;
    case 'door':
      return 0x92400e;
    case 'window':
      return 0x60a5fa;
    case 'floor':
      return 0xe2e8f0;
  }
}

function getLabelTextureScale(viewScale: number) {
  return Math.min(
    maxScale,
    Math.max(
      1,
      Math.ceil(viewScale / labelTextureScaleStep) * labelTextureScaleStep,
    ),
  );
}

function destroyDisplayObject(
  displayObject: Container | Graphics | Sprite | Text,
) {
  displayObject.destroy({ children: true });
}

function getLightGradientTexture(size: number) {
  const cachedTexture = lightGradientTextureCache.get(size);
  if (cachedTexture) {
    return cachedTexture;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (!context) {
    return Texture.WHITE;
  }

  const center = size / 2;
  const gradient = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.72)');
  gradient.addColorStop(0.48, 'rgba(255, 255, 255, 0.28)');
  gradient.addColorStop(0.78, 'rgba(255, 255, 255, 0.07)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = Texture.from(canvas);
  lightGradientTextureCache.set(size, texture);
  return texture;
}

function getLightAlpha(intensity: number) {
  return Math.min(0.58, 0.14 + intensity * 0.36);
}

function createVisibilityMask(light: FloorplanScene['lights'][number]) {
  const mask = new Graphics();
  mask.includeInBuild = false;

  if (light.visibilityPolygon && light.visibilityPolygon.length >= 3) {
    mask
      .poly(light.visibilityPolygon.flatMap((point) => [point.x, point.y]))
      .fill({ color: 0xffffff, alpha: 1 });
    return mask;
  }

  mask.circle(light.x, light.y, light.radius).fill({
    color: 0xffffff,
    alpha: 1,
  });
  return mask;
}

function createSceneRenderState(world: Container): SceneRenderState {
  const backgroundLayer = new Container();
  const groupLayer = new Container();
  const tileLayer = new Container();
  const lightLayer = new Container();
  const groupOutlineLayer = new Container();
  const markerLayer = new Container();
  const labelLayer = new Container();
  const tileGraphics = new Graphics();

  tileLayer.addChild(tileGraphics);
  world.addChild(
    backgroundLayer,
    groupLayer,
    tileLayer,
    lightLayer,
    groupOutlineLayer,
    markerLayer,
    labelLayer,
  );

  return {
    backgroundLayer,
    groupLayer,
    groupOutlineLayer,
    tileLayer,
    lightLayer,
    markerLayer,
    labelLayer,
    backgroundSprite: null,
    tileGraphics,
    tileSource: null,
    groupEntries: new Map(),
    lightEntries: new Map(),
    lightMarkerEntries: new Map(),
    labelTextureScale: 1,
    labelViewScale: 1,
    sensorMarkerEntries: new Map(),
    sensorLabelEntries: new Map(),
  };
}

function syncBackground(renderState: SceneRenderState, scene: FloorplanScene) {
  if (!scene.backgroundImage) {
    if (renderState.backgroundSprite) {
      renderState.backgroundLayer.removeChild(renderState.backgroundSprite);
      destroyDisplayObject(renderState.backgroundSprite);
      renderState.backgroundSprite = null;
      renderState.backgroundImage = undefined;
    }
    return;
  }

  if (
    !renderState.backgroundSprite ||
    renderState.backgroundImage !== scene.backgroundImage
  ) {
    if (renderState.backgroundSprite) {
      renderState.backgroundLayer.removeChild(renderState.backgroundSprite);
      destroyDisplayObject(renderState.backgroundSprite);
    }

    renderState.backgroundSprite = new Sprite(
      Texture.from(scene.backgroundImage),
    );
    renderState.backgroundLayer.addChild(renderState.backgroundSprite);
    renderState.backgroundImage = scene.backgroundImage;
  }

  renderState.backgroundSprite.width = scene.width;
  renderState.backgroundSprite.height = scene.height;
}

function syncTiles(renderState: SceneRenderState, scene: FloorplanScene) {
  if (renderState.tileSource === scene.tiles) {
    return;
  }

  renderState.tileSource = scene.tiles;
  renderState.tileGraphics.clear();

  for (const tile of scene.tiles) {
    renderState.tileGraphics
      .rect(tile.x, tile.y, tile.width, tile.height)
      .fill({
        color: getTileColor(tile),
        alpha:
          tile.type === 'floor' ? (scene.backgroundImage ? 0.05 : 0.18) : 0.9,
      });
  }
}

function drawGroupMask(
  entry: GroupRenderEntry,
  group: FloorplanScene['groups'][number],
  scene: FloorplanScene,
  selected: boolean,
  viewScale: number,
) {
  const color = getGroupColor(group.groupId);
  const alpha = selected ? 0.05 : 0.025;
  const graphics = entry.graphics;

  graphics.clear();
  for (const cell of group.cells) {
    graphics
      .rect(
        cell.x * scene.tileWidth,
        cell.y * scene.tileHeight,
        scene.tileWidth,
        scene.tileHeight,
      )
      .fill({ color, alpha });
  }
  // Outlines sit above light gradients, but below the device markers.
  const scale = Math.max(viewScale, 0.0001);
  entry.outline.clear();
  for (const edge of getGroupOutline(group.cells).edges) {
    const ax = edge.a.x * scene.tileWidth,
      ay = edge.a.y * scene.tileHeight;
    const bx = edge.b.x * scene.tileWidth,
      by = edge.b.y * scene.tileHeight;
    const length = Math.hypot(bx - ax, by - ay);
    for (let d = 0; d < length; d += 9 / scale) {
      const end = Math.min(length, d + 5 / scale);
      entry.outline
        .moveTo(ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length)
        .lineTo(
          ax + ((bx - ax) * end) / length,
          ay + ((by - ay) * end) / length,
        );
    }
  }
  entry.outline.stroke({
    color,
    alpha: selected ? 0.85 : 0.5,
    width: (selected ? 1.4 : 1) / scale,
  });
}

function getGroupDrawKey(
  group: FloorplanScene['groups'][number],
  scene: FloorplanScene,
  selectedSet: ReadonlySet<string>,
  viewScale: number,
) {
  const selected = group.deviceKeys.some((deviceKey) =>
    selectedSet.has(deviceKey),
  );
  return `${scene.layoutKey}:${getObjectIdentity(group.cells)}:${scene.tileWidth}:${scene.tileHeight}:${selected}:${viewScale}`;
}

function syncGroupLabel(
  entry: GroupRenderEntry,
  group: FloorplanScene['groups'][number],
  scene: FloorplanScene,
  viewScale: number,
  visible: boolean,
) {
  const scale = Math.max(viewScale, 0.0001),
    textureScale = getLabelTextureScale(scale);
  const label = entry.label;
  label.text = group.name;
  label.style.fontSize = GROUP_LABEL_FONT_SIZE * textureScale;
  label.style.stroke = { width: 0, alpha: 0 };
  label.scale.set(1 / (textureScale * scale));
  label.visible = false;
  entry.labelBackground.visible = false;
  if (!visible) return;
  label.style.align = 'center';
  label.style.lineHeight = GROUP_LABEL_LINE_HEIGHT * textureScale;
  const layout = getGroupLabelLayout({
    cells: group.cells,
    text: group.name,
    tileWidth: scene.tileWidth,
    tileHeight: scene.tileHeight,
    scale,
    measure: (text) => {
      label.text = text;
      return label.width * scale;
    },
    avoid: [...scene.lights, ...scene.sensors],
  });
  if (!layout) return;
  label.text = layout.lines.join('\n');
  label.position.set(layout.x, layout.y);
  entry.labelBackground
    .clear()
    .roundRect(
      (-label.width * scale) / 2 - 4,
      -3,
      label.width * scale + 8,
      label.height * scale + 6,
      4,
    )
    .fill({ color: 0xffffff, alpha: 0.95 })
    .stroke({ color: 0x829187, alpha: 0.3, width: 1 });
  entry.labelBackground.position.set(layout.x, layout.y);
  entry.labelBackground.scale.set(1 / scale);
  entry.labelBackground.visible = true;
  label.visible = true;
}

function syncGroups(
  renderState: SceneRenderState,
  scene: FloorplanScene,
  selectedSet: ReadonlySet<string>,
  viewScale: number,
  renderLabels: boolean,
) {
  const seenGroupIds = new Set<string>();

  for (const group of scene.groups) {
    seenGroupIds.add(group.groupId);
    let entry = renderState.groupEntries.get(group.groupId);
    if (!entry) {
      const label = new Text({
        text: group.name,
        style: {
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontSize: GROUP_LABEL_FONT_SIZE,
          fontWeight: '600',
          fill: 0x20342b,
        },
      });
      label.anchor.set(0.5, 0);
      label.alpha = 1;
      entry = {
        drawKey: '',
        graphics: new Graphics(),
        outline: new Graphics(),
        labelBackground: new Graphics(),
        label,
      };
      renderState.groupEntries.set(group.groupId, entry);
      renderState.groupLayer.addChild(entry.graphics);
      renderState.groupOutlineLayer.addChild(
        entry.outline,
        entry.labelBackground,
        entry.label,
      );
    }

    const drawKey = getGroupDrawKey(group, scene, selectedSet, viewScale);
    if (entry.drawKey !== drawKey) {
      entry.drawKey = drawKey;
      drawGroupMask(
        entry,
        group,
        scene,
        group.deviceKeys.some((deviceKey) => selectedSet.has(deviceKey)),
        viewScale,
      );
    }
    syncGroupLabel(
      entry,
      group,
      scene,
      viewScale,
      renderLabels && floorplanLabels(scene).groups,
    );
  }

  for (const [groupId, entry] of renderState.groupEntries) {
    if (seenGroupIds.has(groupId)) {
      continue;
    }

    renderState.groupLayer.removeChild(entry.graphics);
    destroyDisplayObject(entry.graphics);
    renderState.groupOutlineLayer.removeChild(
      entry.outline,
      entry.labelBackground,
      entry.label,
    );
    destroyDisplayObject(entry.outline);
    destroyDisplayObject(entry.labelBackground);
    destroyDisplayObject(entry.label);
    renderState.groupEntries.delete(groupId);
  }
}

function syncLightMask(
  renderState: SceneRenderState,
  entry: LightRenderEntry,
  light: FloorplanScene['lights'][number],
) {
  if (entry.visibilityPolygon === light.visibilityPolygon) {
    return;
  }

  if (entry.mask) {
    renderState.lightLayer.removeChild(entry.mask);
    destroyDisplayObject(entry.mask);
    entry.mask = null;
  }

  entry.visibilityPolygon = light.visibilityPolygon;
  if (light.visibilityPolygon && light.visibilityPolygon.length >= 3) {
    entry.mask = createVisibilityMask(light);
    entry.sprite.mask = entry.mask;
    renderState.lightLayer.addChild(entry.mask);
  } else {
    entry.sprite.mask = null;
  }
}

function syncLights(
  renderState: SceneRenderState,
  scene: FloorplanScene,
  quality: RendererQuality,
) {
  const seenDeviceKeys = new Set<string>();
  const texture = getLightGradientTexture(quality.lightTextureSize);

  for (const light of scene.lights) {
    seenDeviceKeys.add(light.deviceKey);
    let entry = renderState.lightEntries.get(light.deviceKey);
    if (!entry) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      renderState.lightLayer.addChild(sprite);
      entry = { sprite, mask: null };
      renderState.lightEntries.set(light.deviceKey, entry);
    } else if (entry.sprite.texture !== texture) {
      entry.sprite.texture = texture;
    }

    entry.sprite.visible = light.power && light.intensity > 0;
    entry.sprite.position.set(light.x, light.y);
    entry.sprite.width = light.radius * 2;
    entry.sprite.height = light.radius * 2;
    entry.sprite.tint = toneMapLightColor(light.color, light.intensity);
    entry.sprite.alpha = getLightAlpha(light.intensity);
    syncLightMask(renderState, entry, light);
  }

  for (const [deviceKey, entry] of renderState.lightEntries) {
    if (seenDeviceKeys.has(deviceKey)) {
      continue;
    }

    renderState.lightLayer.removeChild(entry.sprite);
    destroyDisplayObject(entry.sprite);
    if (entry.mask) {
      renderState.lightLayer.removeChild(entry.mask);
      destroyDisplayObject(entry.mask);
    }
    renderState.lightEntries.delete(deviceKey);
  }
}

function drawLightMarker(
  graphics: Graphics,
  light: FloorplanScene['lights'][number],
  selected: boolean,
  hovered = false,
) {
  graphics.clear();
  const disabled = light.health === 'disabled';
  const tint = disabled
    ? 0x7b8490
    : light.power
      ? rgbToHex(light.color)
      : 0x94a3b8;
  graphics.alpha = disabled ? (hovered ? 0.75 : 0.45) : 1;
  graphics.pivot.set(light.x, light.y);
  graphics.position.set(light.x, light.y);
  graphics.scale.set(hovered ? 1.1 : 1);
  if (hovered || selected)
    graphics
      .circle(light.x, light.y, 23)
      .fill({ color: selected ? 0xffffff : tint, alpha: 0.12 });
  graphics
    .circle(light.x, light.y + 2, 18)
    .fill({ color: 0x000000, alpha: 0.25 });
  graphics
    .circle(light.x, light.y, 18)
    .fill({ color: 0x172027, alpha: 0.96 })
    .stroke({
      color: selected ? 0xffffff : hovered ? 0xd1d5db : 0x64748b,
      width: selected ? 2.5 : 1,
      alpha: 0.85,
    });
  graphics
    .circle(light.x, light.y, 10)
    .fill({ color: tint, alpha: disabled || !light.power ? 0.35 : 0.9 })
    .stroke({ color: tint, width: 1.3 });
  graphics
    .circle(light.x, light.y, 14)
    .stroke({ color: 0x64748b, width: 2.5, alpha: 0.5 });
  const brightness =
    light.power && !disabled ? Math.max(0, Math.min(1, light.intensity)) : 0;
  if (brightness > 0)
    graphics
      // Start at the arc, otherwise Pixi joins it to the previous path origin.
      .moveTo(light.x, light.y - 14)
      .arc(
        light.x,
        light.y,
        14,
        -Math.PI / 2,
        -Math.PI / 2 + brightness * Math.PI * 2,
      )
      .stroke({ color: tint, width: 2.5, cap: 'butt' });

  if (selected) {
    graphics
      .moveTo(light.x - 8, light.y)
      .lineTo(light.x - 2, light.y + 7)
      .lineTo(light.x + 10, light.y - 9)
      .stroke({ color: 0xffffff, width: 4, alpha: 1 });
  }
  if (
    light.health === 'offline' ||
    light.health === 'stale' ||
    light.health === 'unknown'
  ) {
    const x = light.x + 15,
      y = light.y - 15;
    graphics
      .moveTo(x, y - 9)
      .lineTo(x + 9, y + 7)
      .lineTo(x - 9, y + 7)
      .closePath()
      .fill({ color: 0xf59e0b })
      .stroke({ color: 0x0f172a, width: 1 });
    graphics
      .moveTo(x, y - 3)
      .lineTo(x, y + 1)
      .stroke({ color: 0x0f172a, width: 2 });
    graphics.circle(x, y + 4, 1).fill({ color: 0x0f172a });
  } else if (light.health === 'disabled') {
    graphics.circle(light.x + 15, light.y - 15, 7).fill({ color: 0x64748b });
    graphics
      .moveTo(light.x + 12, light.y - 15)
      .lineTo(light.x + 18, light.y - 15)
      .stroke({ color: 0xffffff, width: 2 });
  }
}

function drawSensorMarker(
  graphics: Graphics,
  sensor: FloorplanScene['sensors'][number],
  hovered = false,
) {
  graphics.clear();
  if (hovered)
    graphics
      .circle(sensor.x, sensor.y, 22 * sensor.scale)
      .fill({ color: 0x94a3b8, alpha: 0.18 })
      .stroke({ color: 0xe2e8f0, width: 1 });
  graphics
    .roundRect(
      sensor.x - 14 * sensor.scale,
      sensor.y - 14 * sensor.scale,
      28 * sensor.scale,
      28 * sensor.scale,
      7 * sensor.scale,
    )
    .fill({ color: 0x172027, alpha: 0.96 })
    .stroke({
      color: sensor.color ? rgbToHex(sensor.color) : 0x7da8bc,
      width: 1.5,
      alpha: 0.85,
    });
  if (!sensor.statusLabel) {
    graphics
      .circle(sensor.x, sensor.y, 4 * sensor.scale)
      .fill({ color: sensor.color ? rgbToHex(sensor.color) : 0x7da8bc });
    graphics
      .circle(sensor.x, sensor.y, 8 * sensor.scale)
      .stroke({ color: 0x7da8bc, width: sensor.scale, alpha: 0.45 });
  }
}

function syncMarkers(
  renderState: SceneRenderState,
  scene: FloorplanScene,
  selectedSet: ReadonlySet<string>,
) {
  const seenLightKeys = new Set<string>();
  const seenSensorKeys = new Set<string>();

  for (const light of scene.lights) {
    seenLightKeys.add(light.deviceKey);
    let graphics = renderState.lightMarkerEntries.get(light.deviceKey);
    if (!graphics) {
      graphics = new Graphics();
      renderState.lightMarkerEntries.set(light.deviceKey, graphics);
      renderState.markerLayer.addChild(graphics);
    }

    drawLightMarker(
      graphics,
      light,
      selectedSet.has(light.deviceKey),
      renderState.hoveredKey === light.deviceKey,
    );
  }

  for (const sensor of scene.sensors) {
    seenSensorKeys.add(sensor.deviceKey);
    let graphics = renderState.sensorMarkerEntries.get(sensor.deviceKey);
    if (!graphics) {
      graphics = new Graphics();
      renderState.sensorMarkerEntries.set(sensor.deviceKey, graphics);
      renderState.markerLayer.addChild(graphics);
    }

    drawSensorMarker(
      graphics,
      sensor,
      renderState.hoveredKey === sensor.deviceKey,
    );
  }

  for (const [deviceKey, graphics] of renderState.lightMarkerEntries) {
    if (seenLightKeys.has(deviceKey)) {
      continue;
    }

    renderState.markerLayer.removeChild(graphics);
    destroyDisplayObject(graphics);
    renderState.lightMarkerEntries.delete(deviceKey);
  }

  for (const [deviceKey, graphics] of renderState.sensorMarkerEntries) {
    if (seenSensorKeys.has(deviceKey)) {
      continue;
    }

    renderState.markerLayer.removeChild(graphics);
    destroyDisplayObject(graphics);
    renderState.sensorMarkerEntries.delete(deviceKey);
  }
}

function createSensorLabel(
  sensor: FloorplanScene['sensors'][number],
  textureScale: number,
) {
  const container = new Container();
  const label = new Text({
    text: sensor.label,
    style: {
      align: 'center',
      fill: 0xe5e7eb,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: 11 * sensor.scale * textureScale,
      fontWeight: '700',
      stroke: { color: 0x0f172a, width: 3 * textureScale },
    },
  });
  label.anchor.set(0.5, 0);
  label.scale.set(1 / textureScale);
  container.addChild(label);

  return { container, label, status: null } satisfies SensorLabelRenderEntry;
}

function syncSensorLabel(
  entry: SensorLabelRenderEntry,
  sensor: FloorplanScene['sensors'][number],
  textureScale: number,
  viewScale: number,
) {
  // Labels describe the map; keep their screen size stable while it zooms.
  const labelScale = 1 / (textureScale * Math.max(viewScale, 0.0001));
  entry.label.text = sensor.label;
  entry.label.style.fontSize = 11 * sensor.scale * textureScale;
  entry.label.style.stroke = { color: 0x0f172a, width: 2 * textureScale };
  entry.label.scale.set(labelScale);
  entry.label.position.set(sensor.x, sensor.y + 22 * sensor.scale);

  if (!sensor.statusLabel) {
    if (entry.status) {
      entry.container.removeChild(entry.status);
      destroyDisplayObject(entry.status);
      entry.status = null;
    }
    return;
  }

  if (!entry.status) {
    entry.status = new Text({
      text: sensor.statusLabel,
      style: {
        align: 'center',
        fill: 0xffffff,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 9 * sensor.scale * textureScale,
        fontWeight: '800',
      },
    });
    entry.status.anchor.set(0.5);
    entry.container.addChild(entry.status);
  }

  entry.status.text = sensor.statusLabel;
  entry.status.style.fontSize = 9 * sensor.scale * textureScale;
  entry.status.scale.set(labelScale);
  entry.status.position.set(sensor.x, sensor.y);
}

function sceneLabels(scene: FloorplanScene): FloorplanScene['sensors'] {
  const labels = floorplanLabels(scene);
  return [
    ...(labels.sensors ? scene.sensors : []),
    ...(labels.lights
      ? scene.lights.map((light) => ({
          deviceKey: light.deviceKey,
          x: light.x,
          y: light.y,
          scale: 1,
          label: light.label ?? light.deviceKey,
        }))
      : []),
  ];
}

function syncSensorLabels(
  renderState: SceneRenderState,
  scene: FloorplanScene,
  renderLabels: boolean,
  viewScale: number,
) {
  if (!renderLabels) {
    for (const entry of renderState.sensorLabelEntries.values()) {
      renderState.labelLayer.removeChild(entry.container);
      destroyDisplayObject(entry.container);
    }
    renderState.sensorLabelEntries.clear();
    return;
  }

  const textureScale = getLabelTextureScale(viewScale);
  renderState.labelTextureScale = textureScale;
  renderState.labelViewScale = viewScale;
  const seenDeviceKeys = new Set<string>();

  for (const sensor of sceneLabels(scene)) {
    seenDeviceKeys.add(sensor.deviceKey);
    let entry = renderState.sensorLabelEntries.get(sensor.deviceKey);
    if (!entry) {
      entry = createSensorLabel(sensor, textureScale);
      renderState.sensorLabelEntries.set(sensor.deviceKey, entry);
      renderState.labelLayer.addChild(entry.container);
    }

    syncSensorLabel(entry, sensor, textureScale, viewScale);
  }

  for (const [deviceKey, entry] of renderState.sensorLabelEntries) {
    if (seenDeviceKeys.has(deviceKey)) {
      continue;
    }

    renderState.labelLayer.removeChild(entry.container);
    destroyDisplayObject(entry.container);
    renderState.sensorLabelEntries.delete(deviceKey);
  }
}

function syncLabelTextureScale(
  renderState: SceneRenderState | null,
  scene: FloorplanScene,
  renderLabels: boolean,
  viewScale: number,
) {
  if (!renderState || !renderLabels) {
    return;
  }

  const textureScale = getLabelTextureScale(viewScale);
  if (
    renderState.labelTextureScale === textureScale &&
    renderState.labelViewScale === viewScale
  ) {
    return;
  }

  renderState.labelTextureScale = textureScale;
  renderState.labelViewScale = viewScale;
  for (const sensor of sceneLabels(scene)) {
    const entry = renderState.sensorLabelEntries.get(sensor.deviceKey);
    if (entry) {
      syncSensorLabel(entry, sensor, textureScale, viewScale);
    }
  }
}

function syncScene(
  renderState: SceneRenderState,
  scene: FloorplanScene,
  selectedDeviceKeys: readonly string[],
  quality: RendererQuality,
  renderLabels: boolean,
  viewScale: number,
) {
  const selectedSet = new Set(selectedDeviceKeys);
  syncBackground(renderState, scene);
  syncGroups(renderState, scene, selectedSet, viewScale, renderLabels);
  syncTiles(renderState, scene);
  syncLights(renderState, scene, quality);
  syncMarkers(renderState, scene, selectedSet);
  syncSensorLabels(
    renderState,
    scene,
    quality.renderLabels && renderLabels,
    viewScale,
  );
}

function clampScale(scale: number) {
  return Math.min(maxScale, Math.max(minScale, scale));
}

function getFitTransform(
  container: HTMLDivElement,
  scene: FloorplanScene,
  fitPadding: number,
  focusBounds?: { x: number; y: number; width: number; height: number } | null,
) {
  const width = container.clientWidth;
  const height = container.clientHeight;

  if (width <= 0 || height <= 0 || scene.width <= 0 || scene.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }

  if (focusBounds && focusBounds.width > 0 && focusBounds.height > 0) {
    const scale = clampScale(
      fitPadding *
        Math.min(width / focusBounds.width, height / focusBounds.height),
    );

    return {
      scale,
      x: (width - focusBounds.width * scale) / 2 - focusBounds.x * scale,
      y: (height - focusBounds.height * scale) / 2 - focusBounds.y * scale,
    };
  }

  const scale = clampScale(
    fitPadding * Math.min(width / scene.width, height / scene.height),
  );

  return {
    scale,
    x: (width - scene.width * scale) / 2,
    y: (height - scene.height * scale) / 2,
  };
}

function applyView(world: Container | null, view: ViewTransform) {
  if (!world) {
    return;
  }

  world.position.set(view.x, view.y);
  world.scale.set(view.scale);
}

function getPointerPoint(
  container: HTMLDivElement,
  event: PointerEvent | WheelEvent,
) {
  const bounds = container.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function screenToScene(point: ScreenPoint, view: ViewTransform) {
  return {
    x: (point.x - view.x) / view.scale,
    y: (point.y - view.y) / view.scale,
  };
}

function distance(left: ScreenPoint, right: ScreenPoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function getPinchState(points: ScreenPoint[]): PinchState | null {
  const first = points[0];
  const second = points[1];

  if (!first || !second) {
    return null;
  }

  return {
    center: {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    },
    distance: distance(first, second),
  };
}

function zoomAt(view: ViewTransform, point: ScreenPoint, nextScale: number) {
  const scale = clampScale(nextScale);
  const scenePoint = screenToScene(point, view);

  return {
    scale,
    x: point.x - scenePoint.x * scale,
    y: point.y - scenePoint.y * scale,
  };
}

function findHitTarget(
  scene: FloorplanScene,
  point: ScreenPoint,
): HitTarget | null {
  for (let index = scene.lights.length - 1; index >= 0; index -= 1) {
    const light = scene.lights[index];
    if (!light) {
      continue;
    }

    if (distance(point, light) <= 28) {
      return { type: 'device', key: light.deviceKey };
    }
  }

  for (let index = scene.sensors.length - 1; index >= 0; index -= 1) {
    const sensor = scene.sensors[index];
    if (!sensor) {
      continue;
    }

    if (distance(point, sensor) <= 28 * sensor.scale) {
      return { type: 'sensor', key: sensor.deviceKey };
    }
  }

  let groupTarget: HitTarget | null = null;
  let smallestGroupArea = Number.MAX_SAFE_INTEGER;

  if (scene.tileWidth <= 0 || scene.tileHeight <= 0) {
    return null;
  }

  for (const group of scene.groups) {
    if (group.cells.length >= smallestGroupArea) {
      continue;
    }

    const containsPoint = group.cells.some(
      (cell) =>
        point.x >= cell.x * scene.tileWidth &&
        point.x < (cell.x + 1) * scene.tileWidth &&
        point.y >= cell.y * scene.tileHeight &&
        point.y < (cell.y + 1) * scene.tileHeight,
    );

    if (containsPoint) {
      smallestGroupArea = group.cells.length;
      groupTarget = { type: 'group', key: group.groupId };
    }
  }

  return groupTarget;
}

function invokePress(
  target: HitTarget,
  handlers: RendererHandlers,
  ctrlKey = false,
) {
  if (target.type === 'device') {
    handlers.onDevicePress?.(target.key, { ctrlKey });
    return;
  }

  if (target.type === 'sensor') {
    handlers.onSensorPress?.(target.key);
    return;
  }

  handlers.onGroupPress?.(target.key);
}

function invokeLongPress(target: HitTarget, handlers: RendererHandlers) {
  if (target.type === 'device') {
    handlers.onDeviceLongPress?.(target.key);
    return;
  }

  if (target.type === 'sensor') {
    handlers.onSensorPress?.(target.key);
    return;
  }

  handlers.onGroupLongPress?.(target.key);
}

function getApplicationCanvas(app: Application) {
  try {
    const canvas = app.renderer?.canvas;
    return canvas instanceof HTMLCanvasElement ? canvas : null;
  } catch {
    return null;
  }
}

type GlContext = WebGL2RenderingContext | WebGLRenderingContext;

function readGlContext(app: Application): GlContext | null {
  try {
    return (app.renderer as { gl?: GlContext } | undefined)?.gl ?? null;
  } catch {
    return null;
  }
}

/**
 * Release a WebGL context deterministically.
 *
 * `Application.destroy` drops the renderer but leaves the context for the
 * garbage collector, and a browser only keeps a small number of contexts alive
 * per page. A list that scrolls through many previews therefore piles up
 * contexts until the browser starts evicting the ones on screen, which shows up
 * as previews flickering.
 */
function releaseGlContext(gl: GlContext | null) {
  try {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // The context may already be gone; cleanup stays best-effort.
  }
}

/**
 * Pixi marks its canvas `touch-action: none`, which swallows vertical drags
 * that start on a preview and stops the surrounding list from scrolling. An
 * interactive map claims every gesture on purpose; a read-only preview hands
 * them back to the page.
 */
function applyCanvasTouchAction(
  canvas: HTMLCanvasElement,
  interactive: boolean,
) {
  canvas.style.touchAction = interactive ? 'none' : 'pan-y pinch-zoom';
}

function destroyApplication(app: Application) {
  const gl = readGlContext(app);
  try {
    // Pixi v8 has no Application.stop(): destroying the application stops its
    // ticker. Pausing is done through the ticker below.
    app.ticker?.stop();
    app.destroy(true, { children: true, texture: false, textureSource: false });
  } catch {
    // Pixi can throw when a WebGL context is lost before initialization has
    // produced a renderer. At that point cleanup should stay best-effort.
  }
  releaseGlContext(gl);
}

export function PixiFloorplanRenderer({
  scene,
  selectedDeviceKeys,
  interactive = true,
  fitPadding = 0.86,
  focusBounds = null,
  fitOnResize = false,
  renderLabels = true,
  paused = false,
  onDevicePress,
  onDeviceLongPress,
  onDeviceHold,
  onSensorPress,
  onSensorHold,
  onGroupPress,
  onGroupLongPress,
  onUnavailable,
  onContextLost,
  className,
}: PixiFloorplanRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const renderStateRef = useRef<SceneRenderState | null>(null);
  const latestSceneRef = useRef(scene);
  const selectedKeys = selectedDeviceKeys ?? emptySelection;
  const focusBoundsKey = focusBounds
    ? `${focusBounds.x}:${focusBounds.y}:${focusBounds.width}:${focusBounds.height}`
    : '';
  const latestSelectedKeysRef = useRef(selectedKeys);
  const fitPaddingRef = useRef(fitPadding);
  const focusBoundsRef = useRef(focusBounds);
  const renderLabelsRef = useRef(renderLabels);
  const handlersRef = useRef<RendererHandlers>({
    onDevicePress,
    onDeviceLongPress,
    onDeviceHold,
    onSensorPress,
    onSensorHold,
    onGroupPress,
    onGroupLongPress,
    onUnavailable,
    onContextLost,
  });
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const hasInteractedRef = useRef(false);
  const pausedRef = useRef(paused);
  const pointersRef = useRef(new Map<number, ScreenPoint>());
  const fitSceneRef = useRef<() => void>(() => {});
  const activeGestureRef = useRef<ActiveGesture | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const qualityRef = useRef<RendererQuality | null>(null);

  if (!qualityRef.current && typeof window !== 'undefined') {
    qualityRef.current = getRendererQuality();
  }

  function setView(nextView: ViewTransform) {
    const scaleChanged = nextView.scale !== viewRef.current.scale;
    viewRef.current = nextView;
    applyView(worldRef.current, nextView);
    if (renderStateRef.current && scaleChanged)
      syncGroups(
        renderStateRef.current,
        latestSceneRef.current,
        new Set(latestSelectedKeysRef.current),
        nextView.scale,
        renderLabelsRef.current,
      );
    syncLabelTextureScale(
      renderStateRef.current,
      latestSceneRef.current,
      (qualityRef.current ?? getRendererQuality()).renderLabels &&
        renderLabelsRef.current,
      nextView.scale,
    );
  }

  function clearActiveLongPress() {
    const activeGesture = activeGestureRef.current;
    if (!activeGesture?.longPressTimer) {
      return;
    }

    clearTimeout(activeGesture.longPressTimer);
    activeGesture.longPressTimer = null;
  }

  useEffect(() => {
    handlersRef.current = {
      onDevicePress,
      onDeviceLongPress,
      onDeviceHold,
      onSensorPress,
      onSensorHold,
      onGroupPress,
      onGroupLongPress,
      onUnavailable,
      onContextLost,
    };
    fitPaddingRef.current = fitPadding;
    focusBoundsRef.current = focusBounds;
    renderLabelsRef.current = renderLabels;
  }, [
    fitPadding,
    focusBounds,
    onDevicePress,
    onDeviceLongPress,
    onDeviceHold,
    onGroupLongPress,
    onGroupPress,
    onSensorPress,
    onSensorHold,
    onUnavailable,
    onContextLost,
    renderLabels,
  ]);

  useEffect(() => {
    pausedRef.current = paused;
    const app = appRef.current;
    if (!app) {
      return;
    }

    // Application has no start/stop in Pixi v8 — the ticker is the render loop.
    if (paused) {
      app.ticker?.stop();
    } else {
      app.ticker?.start();
    }
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const app = new Application();
    const world = new Container();
    const pointers = pointersRef.current;
    appRef.current = app;

    fitSceneRef.current = () => {
      setView(
        getFitTransform(
          container,
          latestSceneRef.current,
          fitPaddingRef.current,
          focusBoundsRef.current,
        ),
      );
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      handlersRef.current.onContextLost?.();
    };

    // Browsers usually restore lost contexts themselves (GPU reset, tab
    // restore). Re-frame the scene when that happens so the canvas is not
    // left blank.
    const handleContextRestored = () => {
      fitSceneRef.current();
      const renderState = renderStateRef.current;
      if (renderState) {
        syncScene(
          renderState,
          latestSceneRef.current,
          latestSelectedKeysRef.current,
          qualityRef.current ?? getRendererQuality(),
          renderLabelsRef.current,
          viewRef.current.scale,
        );
      }
      app.render();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const point = getPointerPoint(container, event);
      pointers.set(event.pointerId, point);

      const target = findHitTarget(
        latestSceneRef.current,
        screenToScene(point, viewRef.current),
      );
      clearActiveLongPress();

      const activeGesture: ActiveGesture = {
        pointerId: event.pointerId,
        start: point,
        last: point,
        target,
        moved: false,
        longPressFired: false,
        longPressTimer: null,
      };

      if (target) {
        activeGesture.longPressTimer = setTimeout(() => {
          if (!activeGesture.moved && activeGesture.target) {
            activeGesture.longPressFired = true;
            if (
              (activeGesture.target.type === 'device' &&
                handlersRef.current.onDeviceHold) ||
              (activeGesture.target.type === 'sensor' &&
                handlersRef.current.onSensorHold)
            ) {
              const light = (
                activeGesture.target.type === 'device'
                  ? latestSceneRef.current.lights
                  : latestSceneRef.current.sensors
              ).find((light) => light.deviceKey === activeGesture.target?.key);
              const rect = container.getBoundingClientRect();
              const view = viewRef.current;
              (activeGesture.target.type === 'device'
                ? handlersRef.current.onDeviceHold
                : handlersRef.current.onSensorHold)?.(
                activeGesture.target.key,
                {
                  pointerId: event.pointerId,
                  origin: { x: event.clientX, y: event.clientY },
                  x:
                    rect.left +
                    (light ? light.x * view.scale + view.x : point.x),
                  y:
                    rect.top +
                    (light ? light.y * view.scale + view.y : point.y),
                },
              );
            } else invokeLongPress(activeGesture.target, handlersRef.current);
          }
        }, longPressDelayMs);
      }

      activeGestureRef.current = activeGesture;

      if (pointers.size >= 2) {
        clearActiveLongPress();
        pinchRef.current = getPinchState(Array.from(pointers.values()));
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) {
        if (event.pointerType === 'mouse') {
          const point = getPointerPoint(container, event);
          const bounds = container.getBoundingClientRect();
          const inside =
            event.clientX >= bounds.left &&
            event.clientX <= bounds.right &&
            event.clientY >= bounds.top &&
            event.clientY <= bounds.bottom;
          const target =
            inside &&
            findHitTarget(
              latestSceneRef.current,
              screenToScene(point, viewRef.current),
            );
          container.style.cursor = target ? 'pointer' : 'grab';
          const state = renderStateRef.current;
          const hoveredKey =
            target && target.type !== 'group' ? target.key : undefined;
          if (state && state.hoveredKey !== hoveredKey) {
            state.hoveredKey = hoveredKey;
            syncMarkers(
              state,
              latestSceneRef.current,
              new Set(latestSelectedKeysRef.current),
            );
          }
        }
        return;
      }

      event.preventDefault();
      const point = getPointerPoint(container, event);
      pointers.set(event.pointerId, point);

      if (pointers.size >= 2) {
        clearActiveLongPress();
        hasInteractedRef.current = true;
        const nextPinch = getPinchState(Array.from(pointers.values()));
        const previousPinch = pinchRef.current;

        if (nextPinch && previousPinch && previousPinch.distance > 0) {
          const scaled = zoomAt(
            viewRef.current,
            previousPinch.center,
            viewRef.current.scale *
              (nextPinch.distance / previousPinch.distance),
          );
          setView({
            ...scaled,
            x: scaled.x + nextPinch.center.x - previousPinch.center.x,
            y: scaled.y + nextPinch.center.y - previousPinch.center.y,
          });
        }

        pinchRef.current = nextPinch;
        const activeGesture = activeGestureRef.current;
        if (activeGesture) {
          activeGesture.moved = true;
        }
        return;
      }

      const activeGesture = activeGestureRef.current;
      if (!activeGesture || activeGesture.pointerId !== event.pointerId) {
        return;
      }

      // A held light belongs to the radial control until release. Panning
      // still starts normally when movement occurs before the hold threshold.
      if (
        activeGesture.longPressFired &&
        ((activeGesture.target?.type === 'device' &&
          handlersRef.current.onDeviceHold) ||
          (activeGesture.target?.type === 'sensor' &&
            handlersRef.current.onSensorHold))
      )
        return;
      const deltaX = point.x - activeGesture.last.x;
      const deltaY = point.y - activeGesture.last.y;
      const movedDistance = distance(activeGesture.start, point);

      if (movedDistance > tapMoveTolerancePx) {
        clearActiveLongPress();
        hasInteractedRef.current = true;
        activeGesture.moved = true;
      }

      if (activeGesture.moved) {
        setView({
          ...viewRef.current,
          x: viewRef.current.x + deltaX,
          y: viewRef.current.y + deltaY,
        });
      }

      activeGesture.last = point;
    };

    const handlePointerUp = (event: PointerEvent) => {
      const activeGesture = activeGestureRef.current;
      pointers.delete(event.pointerId);

      if (pointers.size < 2) {
        pinchRef.current = null;
      }

      if (!activeGesture || activeGesture.pointerId !== event.pointerId) {
        return;
      }

      clearActiveLongPress();

      if (
        event.type !== 'pointercancel' &&
        !activeGesture.moved &&
        !activeGesture.longPressFired &&
        activeGesture.target
      ) {
        invokePress(activeGesture.target, handlersRef.current, event.ctrlKey);
      }

      activeGestureRef.current = null;
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      hasInteractedRef.current = true;
      const point = getPointerPoint(container, event);
      const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView(
        zoomAt(viewRef.current, point, viewRef.current.scale * zoomFactor),
      );
    };

    if (interactive) {
      container.addEventListener('pointerdown', handlePointerDown, {
        passive: false,
      });
      container.addEventListener('wheel', handleWheel, { passive: false });
      window.addEventListener('pointermove', handlePointerMove, {
        passive: false,
      });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    }

    void app
      .init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        powerPreference: 'high-performance',
        resizeTo: container,
        resolution: Math.min(
          window.devicePixelRatio || 1,
          qualityRef.current?.resolutionCap ?? 1.5,
        ),
      })
      .then(() => {
        if (disposed) {
          destroyApplication(app);
          return;
        }

        const canvas = getApplicationCanvas(app);
        if (!canvas) {
          handlersRef.current.onUnavailable?.();
          destroyApplication(app);
          return;
        }

        worldRef.current = world;
        const renderState = createSceneRenderState(world);
        renderStateRef.current = renderState;
        app.stage.addChild(world);
        container.appendChild(canvas);
        applyCanvasTouchAction(canvas, interactive);
        if (!interactive) {
          // A preview never needs Pixi to cancel the browser's default
          // gestures; doing so would block scrolling started on the preview.
          app.renderer.events.autoPreventDefault = false;
        }
        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);
        fitSceneRef.current();
        syncScene(
          renderState,
          latestSceneRef.current,
          latestSelectedKeysRef.current,
          qualityRef.current ?? getRendererQuality(),
          renderLabelsRef.current,
          viewRef.current.scale,
        );

        if (pausedRef.current) {
          app.ticker?.stop();
        }

        let lastContainerSize = {
          width: container.clientWidth,
          height: container.clientHeight,
        };
        resizeObserver = new ResizeObserver(() => {
          app.resize();
          applyCanvasTouchAction(canvas, interactive);
          const width = container.clientWidth;
          const height = container.clientHeight;
          // Mobile browsers resize the viewport when their toolbars slide away
          // during a scroll. Re-framing for those height-only changes made
          // previews visibly jump while scrolling, so only refit for real
          // layout changes.
          const toolbarResize =
            width === lastContainerSize.width &&
            Math.abs(height - lastContainerSize.height) <= 120;
          lastContainerSize = { width, height };
          if (fitOnResize || (!hasInteractedRef.current && !toolbarResize)) {
            fitSceneRef.current();
          }
        });
        resizeObserver.observe(container);
      })
      .catch(() => {
        if (!disposed) {
          handlersRef.current.onUnavailable?.();
        }
      });

    return () => {
      disposed = true;
      clearActiveLongPress();
      resizeObserver?.disconnect();
      if (interactive) {
        container.removeEventListener('pointerdown', handlePointerDown);
        container.removeEventListener('wheel', handleWheel);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
      }
      const canvas = getApplicationCanvas(app);
      canvas?.removeEventListener('webglcontextlost', handleContextLost);
      canvas?.removeEventListener(
        'webglcontextrestored',
        handleContextRestored,
      );
      canvas?.remove();
      pointers.clear();
      activeGestureRef.current = null;
      pinchRef.current = null;
      appRef.current = null;
      worldRef.current = null;
      renderStateRef.current = null;
      destroyApplication(app);
    };
  }, [interactive, fitOnResize]);

  useEffect(() => {
    latestSceneRef.current = scene;
    latestSelectedKeysRef.current = selectedKeys;

    const renderState = renderStateRef.current;
    if (!renderState) {
      return;
    }

    syncScene(
      renderState,
      scene,
      selectedKeys,
      qualityRef.current ?? getRendererQuality(),
      renderLabelsRef.current,
      viewRef.current.scale,
    );
  }, [renderLabels, scene, selectedKeys]);

  useEffect(() => {
    if (!worldRef.current) {
      return;
    }

    hasInteractedRef.current = false;
    fitSceneRef.current();
  }, [fitPadding, focusBoundsKey, scene.height, scene.width]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute inset-0 overflow-hidden',
        // An interactive map claims every gesture for pan and zoom. A
        // read-only preview must not: vertical drags have to scroll the
        // surrounding list, while taps still arrive as clicks.
        interactive ? 'touch-none' : 'touch-pan-y touch-pinch-zoom',
        className,
      )}
    />
  );
}
