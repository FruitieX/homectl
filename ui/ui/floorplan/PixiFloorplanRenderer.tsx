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
  renderLabels?: boolean;
  onDevicePress?: (deviceKey: string) => void;
  onDeviceLongPress?: (deviceKey: string) => void;
  onSensorPress?: (deviceKey: string) => void;
  onGroupPress?: (groupId: string) => void;
  onGroupLongPress?: (groupId: string) => void;
  onUnavailable?: () => void;
  className?: string;
}

interface RendererHandlers {
  onDevicePress?: (deviceKey: string) => void;
  onDeviceLongPress?: (deviceKey: string) => void;
  onSensorPress?: (deviceKey: string) => void;
  onGroupPress?: (groupId: string) => void;
  onGroupLongPress?: (groupId: string) => void;
  onUnavailable?: () => void;
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
}

interface SceneRenderState {
  backgroundLayer: Container;
  groupLayer: Container;
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
  sensorMarkerEntries: Map<string, Graphics>;
  sensorLabelEntries: Map<string, SensorLabelRenderEntry>;
}

const emptySelection: readonly string[] = [];
const longPressDelayMs = 500;
const tapMoveTolerancePx = 8;
const minScale = 0.08;
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
      renderLabels: false,
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
  return hslToHex(hash, 0.72, 0.55);
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
  const markerLayer = new Container();
  const labelLayer = new Container();
  const tileGraphics = new Graphics();

  tileLayer.addChild(tileGraphics);
  world.addChild(
    backgroundLayer,
    groupLayer,
    tileLayer,
    lightLayer,
    markerLayer,
    labelLayer,
  );

  return {
    backgroundLayer,
    groupLayer,
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

    renderState.backgroundSprite = new Sprite(Texture.from(scene.backgroundImage));
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
    renderState.tileGraphics.rect(tile.x, tile.y, tile.width, tile.height).fill({
      color: getTileColor(tile),
      alpha:
        tile.type === 'floor' ? (scene.backgroundImage ? 0.05 : 0.18) : 0.9,
    });
  }
}

function drawGroupMask(
  graphics: Graphics,
  group: FloorplanScene['groups'][number],
  scene: FloorplanScene,
  selected: boolean,
) {
  const color = getGroupColor(group.groupId);
  const alpha = selected ? 0.34 : 0.16;

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
}

function getGroupDrawKey(
  group: FloorplanScene['groups'][number],
  scene: FloorplanScene,
  selectedSet: ReadonlySet<string>,
) {
  const selected = group.deviceKeys.some((deviceKey) => selectedSet.has(deviceKey));
  return `${scene.layoutKey}:${getObjectIdentity(group.cells)}:${scene.tileWidth}:${scene.tileHeight}:${selected}`;
}

function syncGroups(
  renderState: SceneRenderState,
  scene: FloorplanScene,
  selectedSet: ReadonlySet<string>,
) {
  const seenGroupIds = new Set<string>();

  for (const group of scene.groups) {
    seenGroupIds.add(group.groupId);
    let entry = renderState.groupEntries.get(group.groupId);
    if (!entry) {
      entry = { drawKey: '', graphics: new Graphics() };
      renderState.groupEntries.set(group.groupId, entry);
      renderState.groupLayer.addChild(entry.graphics);
    }

    const drawKey = getGroupDrawKey(group, scene, selectedSet);
    if (entry.drawKey !== drawKey) {
      entry.drawKey = drawKey;
      drawGroupMask(
        entry.graphics,
        group,
        scene,
        group.deviceKeys.some((deviceKey) => selectedSet.has(deviceKey)),
      );
    }
  }

  for (const [groupId, entry] of renderState.groupEntries) {
    if (seenGroupIds.has(groupId)) {
      continue;
    }

    renderState.groupLayer.removeChild(entry.graphics);
    destroyDisplayObject(entry.graphics);
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
) {
  graphics.clear();
  graphics
    .circle(light.x, light.y, 18)
    .fill({ color: rgbToHex(light.color), alpha: light.power ? 1 : 0.35 })
    .stroke({
      color: selected ? 0xffffff : 0x0f172a,
      width: selected ? 5 : 3,
      alpha: 0.95,
    });

  if (selected) {
    graphics
      .moveTo(light.x - 8, light.y)
      .lineTo(light.x - 2, light.y + 7)
      .lineTo(light.x + 10, light.y - 9)
      .stroke({ color: 0xffffff, width: 4, alpha: 1 });
  }
}

function drawSensorMarker(
  graphics: Graphics,
  sensor: FloorplanScene['sensors'][number],
) {
  graphics.clear();
  graphics
    .regularPoly(sensor.x, sensor.y, 16 * sensor.scale, 3)
    .fill({ color: sensor.color ? rgbToHex(sensor.color) : 0x38bdf8, alpha: 0.95 })
    .stroke({ color: 0x0f172a, width: 2, alpha: 0.9 });
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

    drawLightMarker(graphics, light, selectedSet.has(light.deviceKey));
  }

  for (const sensor of scene.sensors) {
    seenSensorKeys.add(sensor.deviceKey);
    let graphics = renderState.sensorMarkerEntries.get(sensor.deviceKey);
    if (!graphics) {
      graphics = new Graphics();
      renderState.sensorMarkerEntries.set(sensor.deviceKey, graphics);
      renderState.markerLayer.addChild(graphics);
    }

    drawSensorMarker(graphics, sensor);
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
) {
  entry.label.text = sensor.label;
  entry.label.style.fontSize = 11 * sensor.scale * textureScale;
  entry.label.style.stroke = { color: 0x0f172a, width: 3 * textureScale };
  entry.label.scale.set(1 / textureScale);
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
  entry.status.scale.set(1 / textureScale);
  entry.status.position.set(sensor.x, sensor.y);
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
  const seenDeviceKeys = new Set<string>();

  for (const sensor of scene.sensors) {
    seenDeviceKeys.add(sensor.deviceKey);
    let entry = renderState.sensorLabelEntries.get(sensor.deviceKey);
    if (!entry) {
      entry = createSensorLabel(sensor, textureScale);
      renderState.sensorLabelEntries.set(sensor.deviceKey, entry);
      renderState.labelLayer.addChild(entry.container);
    }

    syncSensorLabel(entry, sensor, textureScale);
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
  if (renderState.labelTextureScale === textureScale) {
    return;
  }

  renderState.labelTextureScale = textureScale;
  for (const sensor of scene.sensors) {
    const entry = renderState.sensorLabelEntries.get(sensor.deviceKey);
    if (entry) {
      syncSensorLabel(entry, sensor, textureScale);
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
  syncGroups(renderState, scene, selectedSet);
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
) {
  const width = container.clientWidth;
  const height = container.clientHeight;

  if (width <= 0 || height <= 0 || scene.width <= 0 || scene.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
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

function invokePress(target: HitTarget, handlers: RendererHandlers) {
  if (target.type === 'device') {
    handlers.onDevicePress?.(target.key);
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

function destroyApplication(app: Application) {
  try {
    app.stop();
    app.destroy(true, { children: true, texture: false, textureSource: false });
  } catch {
    // Pixi can throw when a WebGL context is lost before initialization has
    // produced a renderer. At that point cleanup should stay best-effort.
  }
}

export function PixiFloorplanRenderer({
  scene,
  selectedDeviceKeys,
  interactive = true,
  fitPadding = 0.86,
  renderLabels = true,
  onDevicePress,
  onDeviceLongPress,
  onSensorPress,
  onGroupPress,
  onGroupLongPress,
  onUnavailable,
  className,
}: PixiFloorplanRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const renderStateRef = useRef<SceneRenderState | null>(null);
  const latestSceneRef = useRef(scene);
  const selectedKeys = selectedDeviceKeys ?? emptySelection;
  const latestSelectedKeysRef = useRef(selectedKeys);
  const fitPaddingRef = useRef(fitPadding);
  const renderLabelsRef = useRef(renderLabels);
  const handlersRef = useRef<RendererHandlers>({
    onDevicePress,
    onDeviceLongPress,
    onSensorPress,
    onGroupPress,
    onGroupLongPress,
    onUnavailable,
  });
  const viewRef = useRef<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const hasInteractedRef = useRef(false);
  const pointersRef = useRef(new Map<number, ScreenPoint>());
  const fitSceneRef = useRef<() => void>(() => {});
  const activeGestureRef = useRef<ActiveGesture | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const qualityRef = useRef<RendererQuality | null>(null);

  if (!qualityRef.current && typeof window !== 'undefined') {
    qualityRef.current = getRendererQuality();
  }

  function setView(nextView: ViewTransform) {
    viewRef.current = nextView;
    applyView(worldRef.current, nextView);
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
      onSensorPress,
      onGroupPress,
      onGroupLongPress,
      onUnavailable,
    };
    fitPaddingRef.current = fitPadding;
    renderLabelsRef.current = renderLabels;
  }, [
    fitPadding,
    onDevicePress,
    onDeviceLongPress,
    onGroupLongPress,
    onGroupPress,
    onSensorPress,
    onUnavailable,
    renderLabels,
  ]);

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
        ),
      );
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      handlersRef.current.onUnavailable?.();
    };

    const handlePointerDown = (event: PointerEvent) => {
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
            invokeLongPress(activeGesture.target, handlersRef.current);
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
        !activeGesture.moved &&
        !activeGesture.longPressFired &&
        activeGesture.target
      ) {
        invokePress(activeGesture.target, handlersRef.current);
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
        canvas.addEventListener('webglcontextlost', handleContextLost);
        fitSceneRef.current();
        syncScene(
          renderState,
          latestSceneRef.current,
          latestSelectedKeysRef.current,
          qualityRef.current ?? getRendererQuality(),
          renderLabelsRef.current,
          viewRef.current.scale,
        );

        resizeObserver = new ResizeObserver(() => {
          if (!hasInteractedRef.current) {
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
      canvas?.remove();
      pointers.clear();
      activeGestureRef.current = null;
      pinchRef.current = null;
      appRef.current = null;
      worldRef.current = null;
      renderStateRef.current = null;
      destroyApplication(app);
    };
  }, [interactive]);

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
  }, [fitPadding, scene.height, scene.width]);

  return (
    <div
      ref={containerRef}
      className={cn('absolute inset-0 touch-none overflow-hidden', className)}
    />
  );
}
