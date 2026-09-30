import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Maximize, Minus, Plus, Layers3 } from 'lucide-react';
import type {
  FloorplanGrid,
  GridPoint,
  AvailableFloorplanDevice,
  DrawShape,
  TileType,
} from '@/lib/floorplan-editor';
import {
  applyGroupPoints,
  applyTilePoints,
  getDragShapePoints,
  getLinePoints,
  moveDeviceOnGrid,
  placeSelectedDeviceOnGrid,
} from '@/lib/floorplan-editor';
import { floorplanLabels } from '@/lib/floorplan-labels';
import { sensorMarkerPaths, type SensorMarkerKind } from '@/lib/sensorMarker';
import {
  getGroupLabelLayout,
  GROUP_LABEL_FONT_SIZE,
  GROUP_LABEL_LINE_HEIGHT,
} from '@/lib/floorplan-group-label';
import { getFloorplanRenderMetrics } from '@/lib/floorplan-metrics';
import {
  effectiveDeviceSnap,
  snapDevicePoint,
  type DeviceSnap,
} from '@/lib/floorplan-snapping';
import {
  getFloorplanGroupFill,
  getFloorplanGroupStroke,
} from '@/lib/floorplanGroupColor';
import { Button } from '@/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/ui/primitives/dropdown-menu';
import { FloorplanLayerToggles } from './FloorplanLayerToggles';
export type EditorTool =
  'select' | 'devices' | 'rooms' | 'walls' | 'erase' | 'hand' | 'layout';
export const tileColors: Record<TileType, string> = {
  empty: 'transparent',
  floor: '#e8ece5',
  wall: '#596b61',
  door: '#b89b74',
  window: '#91bac4',
};
type View = { x: number; y: number; scale: number };
const sensorPaths = new Map<SensorMarkerKind, Path2D[]>();
function sensorIconPaths(kind: SensorMarkerKind) {
  let paths = sensorPaths.get(kind);
  if (!paths) {
    paths = sensorMarkerPaths[kind].map((d) => new Path2D(d));
    sensorPaths.set(kind, paths);
  }
  return paths;
}
type Gesture =
  | {
      kind: 'pan';
      x: number;
      y: number;
      room?: string;
      origin?: GridPoint;
      moved?: boolean;
    }
  | { kind: 'pinch'; distance: number; x: number; y: number }
  | { kind: 'move'; before: FloorplanGrid; key: string; offset: GridPoint }
  | {
      kind: 'paint';
      before: FloorplanGrid;
      last: GridPoint;
      start: GridPoint;
      tool: EditorTool;
      shape: DrawShape;
      tile: TileType;
      group: string;
      erase: boolean;
    };
export function FloorplanEditorCanvas({
  grid,
  onChange,
  onCommit,
  devices,
  groups,
  tool,
  material,
  shape,
  room,
  roomErase,
  roomSelected,
  selected,
  centerTarget,
  onSelect,
  onSelectRoom,
  onInspect,
  pending,
  onPlaced,
  background,
  name,
  tray,
  disabled,
  keyboardCell,
  onKeyboardCell,
  snap,
}: {
  grid: FloorplanGrid;
  onChange: (next: FloorplanGrid) => void;
  onCommit: (before: FloorplanGrid) => void;
  devices: AvailableFloorplanDevice[];
  groups: { id: string; name: string }[];
  tool: EditorTool;
  material: TileType;
  shape: DrawShape;
  room: string;
  roomErase: boolean;
  roomSelected: boolean;
  selected: string | null;
  centerTarget: { key: string; serial: number } | null;
  onSelect: (key: string) => void;
  onSelectRoom: (id: string) => void;
  onInspect: () => void;
  pending: string | null;
  onPlaced: () => void;
  background?: string;
  name: string;
  tray: 'library' | 'inspector' | null;
  disabled: boolean;
  keyboardCell: GridPoint;
  onKeyboardCell: (p: GridPoint) => void;
  snap: DeviceSnap;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    gridRef = useRef(grid),
    gesture = useRef<Gesture | null>(null),
    space = useRef(false),
    touches = useRef(new Map<number, GridPoint>());
  const [size, setSize] = useState({ width: 800, height: 500 }),
    [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 }),
    viewRef = useRef(view),
    [image, setImage] = useState<HTMLImageElement>(),
    [imageError, setImageError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [layers, setLayers] = useState({
      grid: false,
      rooms: true,
      devices: true,
      walls: true,
    }),
    [wallOpacity, setWallOpacity] = useState(0.65),
    [hover, setHover] = useState<GridPoint | null>(null),
    [isPanning, setIsPanning] = useState(false);
  const metrics = getFloorplanRenderMetrics(grid, image),
    mobile = window.innerWidth < 900;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const emit = useCallback((next: FloorplanGrid | null) => {
    if (next) {
      gridRef.current = next;
      onChangeRef.current(next);
    }
  }, []);
  useLayoutEffect(() => {
    gridRef.current = grid;
  }, [grid]);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  useLayoutEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setImage(undefined);
    setImageError(false);
    if (!background) return;
    let active = true;
    const next = new Image();
    next.onload = () => {
      if (active) setImage(next);
    };
    next.onerror = () => {
      if (active) setImageError(true);
    };
    next.src = background;
    return () => {
      active = false;
    };
  }, [background, attempt]);
  const fitScale = Math.max(
    0.001,
    Math.min(
      (size.width - 48) / metrics.width,
      (size.height - 112) / metrics.height,
    ),
  );
  const fit = useCallback(() => {
    const scale = Math.max(
      0.001,
      Math.min(
        (size.width - 48) / metrics.width,
        (size.height - 112) / metrics.height,
      ),
    );
    setView({
      scale,
      x: (size.width - metrics.width * scale) / 2,
      y: (size.height - metrics.height * scale) / 2,
    });
  }, [size.width, size.height, metrics.width, metrics.height]);
  useLayoutEffect(() => fit(), [fit]);
  // Mobile sheets never resize the canvas; reframe the view into its unobscured area.
  useLayoutEffect(() => {
    if (!mobile) return;
    if (!tray) {
      fit();
      return;
    }
    const sheet = stage.current?.parentElement?.querySelector(`.fp-${tray}`);
    if (!sheet || !stage.current) return;
    const sheetTop =
      sheet.getBoundingClientRect().top -
      stage.current.getBoundingClientRect().top;
    const height = Math.max(130, sheetTop - 35);
    if (tray === 'library') {
      const scale = Math.min(
        (size.width - 48) / metrics.width,
        (height - 45) / metrics.height,
      );
      setView({
        scale,
        x: (size.width - metrics.width * scale) / 2,
        y: 40 + (height - 45 - metrics.height * scale) / 2,
      });
    } else {
      const device = gridRef.current.devices.find(
        (d) => d.deviceKey === selected,
      );
      const points = roomSelected ? gridRef.current.groups[room] : undefined;
      const position = points?.length
        ? {
            x: points.reduce((n, p) => n + p.x, 0) / points.length,
            y: points.reduce((n, p) => n + p.y, 0) / points.length,
          }
        : device;
      if (position)
        setView((v) => {
          const scale = Math.max(v.scale, fitScale);
          return {
            ...v,
            scale,
            x: size.width / 2 - (position.x + 0.5) * metrics.tileWidth * scale,
            y:
              height / 2 + 20 - (position.y + 0.5) * metrics.tileHeight * scale,
          };
        });
    }
  }, [
    tray,
    fitScale,
    mobile,
    selected,
    room,
    roomSelected,
    tool,
    fit,
    size.width,
    metrics.width,
    metrics.height,
    metrics.tileWidth,
    metrics.tileHeight,
  ]);
  useLayoutEffect(() => {
    if (!centerTarget || mobile) return;
    const d = gridRef.current.devices.find(
      (d) => d.deviceKey === centerTarget.key,
    );
    if (d)
      setView((v) => ({
        ...v,
        x: size.width / 2 - (d.x + 0.5) * metrics.tileWidth * v.scale,
        y: size.height / 2 - (d.y + 0.5) * metrics.tileHeight * v.scale,
      }));
  }, [
    centerTarget,
    mobile,
    size.width,
    size.height,
    metrics.tileWidth,
    metrics.tileHeight,
  ]);
  const zoom = useCallback(
    (factor: number, x = size.width / 2, y = size.height / 2) =>
      setView((v) => {
        const scale = Math.max(
          fitScale * 0.2,
          Math.min(fitScale * 12, v.scale * factor),
        );
        return {
          scale,
          x: x - ((x - v.x) * scale) / v.scale,
          y: y - ((y - v.y) * scale) / v.scale,
        };
      }),
    [fitScale, size.width, size.height],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (gesture.current) return;
      const rect = element.getBoundingClientRect();
      zoom(
        Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.002),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom]);
  useEffect(() => {
    const cancel = () => {
      if (gesture.current && 'before' in gesture.current)
        emit(gesture.current.before);
      gesture.current = null;
      touches.current.clear();
      setIsPanning(false);
      space.current = false;
    };
    const down = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,[role="dialog"],[role="combobox"]',
        )
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        space.current = true;
      }
      if (e.key === 'Escape') cancel();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', cancel);
    };
  }, [emit]);
  useLayoutEffect(() => {
    const element = canvas.current,
      ctx = element?.getContext('2d');
    if (!ctx || !element) return;
    const dpr = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * dpr);
    element.height = Math.round(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);
    ctx.fillStyle = '#f9faf7';
    ctx.fillRect(0, 0, metrics.width, metrics.height);
    if (image) ctx.drawImage(image, 0, 0, metrics.width, metrics.height);
    const tw = metrics.tileWidth,
      th = metrics.tileHeight;
    const startX = Math.max(0, Math.floor(-view.x / view.scale / tw)),
      startY = Math.max(0, Math.floor(-view.y / view.scale / th)),
      endX = Math.min(
        grid.width,
        Math.ceil((size.width - view.x) / view.scale / tw),
      ),
      endY = Math.min(
        grid.height,
        Math.ceil((size.height - view.y) / view.scale / th),
      );
    if (layers.walls) {
      ctx.globalAlpha = image ? wallOpacity : 1;
      if (startX < endX)
        for (let y = startY; y < endY; y++) {
          let run = startX,
            current = grid.tiles[y][startX];
          for (let x = startX + 1; x <= endX; x++) {
            const next = x < endX ? grid.tiles[y][x] : undefined;
            if (next === current) continue;
            if (current !== 'empty' && !(image && current === 'floor')) {
              ctx.fillStyle = tileColors[current];
              ctx.fillRect(run * tw, y * th, (x - run) * tw + 0.05, th + 0.05);
            }
            if (next) current = next;
            run = x;
          }
        }
      ctx.globalAlpha = 1;
    }
    const groupLabels: NonNullable<ReturnType<typeof getGroupLabelLayout>>[] =
      [];
    if (layers.rooms)
      for (const [id, points] of Object.entries(grid.groups)) {
        ctx.fillStyle = getFloorplanGroupFill(
          id,
          roomSelected && id === room ? 0.45 : 0.15,
        );
        for (const p of points) ctx.fillRect(p.x * tw, p.y * th, tw, th);
        if (roomSelected && id === room) {
          ctx.strokeStyle = getFloorplanGroupStroke(id, 0.65);
          ctx.lineWidth = 1 / view.scale;
          for (const p of points) ctx.strokeRect(p.x * tw, p.y * th, tw, th);
        }
        if (floorplanLabels(grid).groups && points.length) {
          ctx.save();
          const fontSize = GROUP_LABEL_FONT_SIZE;
          ctx.font = '600 ' + fontSize + 'px system-ui';
          const label = getGroupLabelLayout({
            cells: points,
            text: groups.find((g) => g.id === id)?.name ?? id,
            tileWidth: tw,
            tileHeight: th,
            scale: view.scale,
            fontSize,
            measure: (text) => ctx.measureText(text).width,
            avoid: grid.devices.map((device) => ({
              x: (device.x + 0.5) * tw,
              y: (device.y + 0.5) * th,
            })),
          });
          if (label) groupLabels.push(label);
          ctx.restore();
        }
      }
    if (layers.grid && tw * view.scale > 3) {
      ctx.strokeStyle = '#91a69b66';
      ctx.lineWidth = 0.5 / view.scale;
      ctx.beginPath();
      for (let x = startX; x <= endX; x++) {
        ctx.moveTo(x * tw, startY * th);
        ctx.lineTo(x * tw, endY * th);
      }
      for (let y = startY; y <= endY; y++) {
        ctx.moveTo(startX * tw, y * th);
        ctx.lineTo(endX * tw, y * th);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#8da19550';
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeRect(0, 0, metrics.width, metrics.height);
    // Captions sit above the optional tile grid, with a readable neutral backing.
    for (const label of groupLabels) {
      ctx.save();
      ctx.translate(label.x, label.y);
      ctx.scale(1 / view.scale, 1 / view.scale);
      ctx.font = `600 ${GROUP_LABEL_FONT_SIZE}px system-ui`;
      const width = Math.max(
        ...label.lines.map((line) => ctx.measureText(line).width),
      );
      ctx.beginPath();
      ctx.roundRect(
        -width / 2 - 4,
        -3,
        width + 8,
        label.lines.length * GROUP_LABEL_LINE_HEIGHT + 6,
        4,
      );
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(130,145,135,.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#20342b';
      label.lines.forEach((line, i) =>
        ctx.fillText(line, 0, i * GROUP_LABEL_LINE_HEIGHT),
      );
      ctx.restore();
    }
    const marker = (x: number, y: number, key: string) => {
      const info = devices.find((d) => d.key === key),
        preview = info?.preview;
      ctx.save();
      ctx.translate((x + 0.5) * tw, (y + 0.5) * th);
      ctx.scale(1 / view.scale, 1 / view.scale);
      const r =
        (mobile && tray === 'library' ? 8 : 12) *
        Math.max(0.5, Math.min(3, grid.deviceScale));
      if (key === selected) {
        ctx.beginPath();
        ctx.arc(0, 0, r + 7, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#518571';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#23423122';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#d9e4dc';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (preview && info?.type !== 'sensor') {
        ctx.beginPath();
        ctx.arc(
          0,
          0,
          r,
          -Math.PI / 2,
          -Math.PI / 2 +
            Math.PI * 2 * Math.max(0, Math.min(1, preview.brightness)),
        );
        ctx.strokeStyle =
          preview.power && !preview.disabled ? '#52806a' : '#94a39a';
        ctx.lineCap = 'butt';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(4, r - 4), 0, Math.PI * 2);
        ctx.fillStyle =
          preview.power && !preview.disabled ? preview.color : '#b5c0b9';
        ctx.fill();
      } else {
        ctx.fillStyle = '#e9f1ec';
        ctx.beginPath();
        ctx.arc(0, 0, r - 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = info ? '#638578' : '#a77b57';
        ctx.font = '600 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (info?.type === 'sensor') {
          ctx.save();
          const iconScale = (r * 1.5) / 24;
          ctx.scale(iconScale, iconScale);
          ctx.translate(-12, -12);
          ctx.strokeStyle = '#456e60';
          ctx.lineWidth = 1.8;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const path of sensorIconPaths(info.sensorMarker ?? 'unknown'))
            ctx.stroke(path);
          ctx.restore();
        } else ctx.fillText(info ? '●' : '?', 0, 1);
      }
      const labels = floorplanLabels(grid);
      if (
        (!mobile || key === selected) &&
        (key === selected ||
          (labels.sensors && info?.type === 'sensor') ||
          (labels.lights && info?.type === 'controllable'))
      ) {
        ctx.font = '500 10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f7faf7';
        const label =
          info?.name ??
          grid.devices.find((d) => d.deviceKey === key)?.deviceName ??
          key;
        ctx.strokeText(label, 0, r + 9);
        ctx.fillStyle = '#567263';
        ctx.fillText(label, 0, r + 9);
      }
      ctx.restore();
    };
    if (layers.devices)
      for (const d of grid.devices) marker(d.x, d.y, d.deviceKey);
    if (pending && hover) {
      ctx.globalAlpha = 0.55;
      marker(hover.x - 0.5, hover.y - 0.5, pending);
      ctx.globalAlpha = 1;
    }
    const cell = hover ?? keyboardCell;
    if (['rooms', 'walls', 'erase'].includes(tool)) {
      ctx.strokeStyle = '#326c56';
      ctx.lineWidth = 2 / view.scale;
      ctx.setLineDash([4 / view.scale, 3 / view.scale]);
      ctx.strokeRect(Math.floor(cell.x) * tw, Math.floor(cell.y) * th, tw, th);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }, [
    grid,
    image,
    size,
    view,
    devices,
    groups,
    tool,
    room,
    roomSelected,
    selected,
    layers,
    wallOpacity,
    hover,
    pending,
    keyboardCell,
    metrics.width,
    metrics.height,
    metrics.tileWidth,
    metrics.tileHeight,
    mobile,
    tray,
  ]);
  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect(),
      v = viewRef.current;
    return {
      x: (e.clientX - r.left - v.x) / v.scale / metrics.tileWidth,
      y: (e.clientY - r.top - v.y) / v.scale / metrics.tileHeight,
    };
  };
  const inBounds = (p: GridPoint) =>
    p.x >= 0 && p.y >= 0 && p.x < grid.width && p.y < grid.height;
  const placement = (
    p: GridPoint,
    modifiers: { altKey?: boolean; shiftKey?: boolean },
  ) =>
    snapDevicePoint(
      p,
      grid.width,
      grid.height,
      effectiveDeviceSnap(snap, modifiers),
    );
  const applyPaint = (g: Extract<Gesture, { kind: 'paint' }>, p: GridPoint) => {
    const cell = {
      x: Math.max(0, Math.min(grid.width - 1, Math.floor(p.x))),
      y: Math.max(0, Math.min(grid.height - 1, Math.floor(p.y))),
    };
    const source = g.shape === 'freehand' ? gridRef.current : g.before,
      points =
        g.shape === 'freehand'
          ? getLinePoints(g.last, cell)
          : getDragShapePoints(g.shape, g.start, cell);
    emit(
      g.tool === 'rooms'
        ? applyGroupPoints(source, g.group, points, g.erase ? 'erase' : 'paint')
        : applyTilePoints(
            source,
            points,
            g.tool === 'erase' ? 'empty' : g.tile,
          ),
    );
    g.last = cell;
  };
  const end = (cancel: boolean) => {
    const g = gesture.current;
    if (g && 'before' in g) {
      if (cancel) emit(g.before);
      else onCommit(g.before);
    }
    gesture.current = null;
    setIsPanning(false);
  };
  return (
    <div
      ref={stage}
      className="fp-stage"
      data-tool={tool}
      data-panning={isPanning}
      data-erasing={tool === 'erase' || (tool === 'rooms' && roomErase)}
    >
      <div className="fp-canvas-title">
        {name || 'New floorplan'}{' '}
        <span>
          {grid.width} × {grid.height} tiles
        </span>
      </div>
      {pending && (
        <div className="fp-pending">
          Place {devices.find((d) => d.key === pending)?.name} · click or tap
          the canvas
        </div>
      )}
      <canvas
        ref={canvas}
        aria-label="Floorplan layout canvas"
        tabIndex={0}
        data-zoom={view.scale}
        data-view-x={view.x}
        data-view-y={view.y}
        data-tile-width={metrics.tileWidth}
        data-tile-height={metrics.tileHeight}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (disabled || e.button === 2) return;
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.current.size === 2) {
            end(true);
            const [a, b] = [...touches.current.values()];
            gesture.current = {
              kind: 'pinch',
              distance: Math.hypot(a.x - b.x, a.y - b.y),
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
            };
            setIsPanning(true);
            return;
          }
          if (touches.current.size > 2) return;
          const p = point(e),
            before = gridRef.current;
          if (e.button === 1 || space.current || tool === 'hand') {
            gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY };
            setIsPanning(true);
            return;
          }
          if (pending && inBounds(p)) {
            const position = placement({ x: p.x - 0.5, y: p.y - 0.5 }, e);
            emit(
              placeSelectedDeviceOnGrid(
                before,
                pending,
                devices,
                position.x,
                position.y,
              ),
            );
            onCommit(before);
            onSelect(pending);
            onPlaced();
            return;
          }
          if ((tool === 'select' || tool === 'devices') && layers.devices) {
            const d = before.devices.find(
              (d) =>
                Math.hypot(
                  (d.x + 0.5 - p.x) * metrics.tileWidth * viewRef.current.scale,
                  (d.y + 0.5 - p.y) *
                    metrics.tileHeight *
                    viewRef.current.scale,
                ) <= Math.max(20, 12 * grid.deviceScale + 7),
            );
            if (d) {
              onSelect(d.deviceKey);
              gesture.current = {
                kind: 'move',
                before,
                key: d.deviceKey,
                offset: { x: d.x - p.x, y: d.y - p.y },
              };
              return;
            }
          }
          if (['select', 'devices', 'layout'].includes(tool)) {
            const hitRoom =
              tool === 'select' && layers.rooms
                ? Object.entries(before.groups)
                    .filter(([, cells]) =>
                      cells.some(
                        (cell) =>
                          cell.x === Math.floor(p.x) &&
                          cell.y === Math.floor(p.y),
                      ),
                    )
                    .sort(
                      ([a, ac], [b, bc]) =>
                        ac.length - bc.length || a.localeCompare(b),
                    )[0]?.[0]
                : undefined;
            gesture.current = {
              kind: 'pan',
              x: e.clientX,
              y: e.clientY,
              room: hitRoom,
              origin: { x: e.clientX, y: e.clientY },
            };
            setIsPanning(true);
            return;
          }
          if (inBounds(p) && (tool !== 'rooms' || room)) {
            const start = { x: Math.floor(p.x), y: Math.floor(p.y) };
            const g: Extract<Gesture, { kind: 'paint' }> = {
              kind: 'paint',
              before,
              last: start,
              start,
              tool,
              shape,
              tile: material,
              group: room,
              erase: roomErase,
            };
            gesture.current = g;
            applyPaint(g, p);
          }
        }}
        onPointerMove={(e) => {
          const p = point(e);
          const preview = pending
            ? placement({ x: p.x - 0.5, y: p.y - 0.5 }, e)
            : null;
          setHover(
            inBounds(p)
              ? preview
                ? { x: preview.x + 0.5, y: preview.y + 0.5 }
                : p
              : null,
          );
          if (touches.current.has(e.pointerId))
            touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const g = gesture.current;
          if (!g) return;
          if (g.kind === 'pinch') {
            if (touches.current.size !== 2) return;
            const [a, b] = [...touches.current.values()],
              distance = Math.hypot(a.x - b.x, a.y - b.y),
              cx = (a.x + b.x) / 2,
              cy = (a.y + b.y) / 2,
              rect = canvas.current!.getBoundingClientRect();
            zoom(
              distance / Math.max(1, g.distance),
              cx - rect.left,
              cy - rect.top,
            );
            setView((v) => ({ ...v, x: v.x + cx - g.x, y: v.y + cy - g.y }));
            g.distance = distance;
            g.x = cx;
            g.y = cy;
          } else if (g.kind === 'pan') {
            if (g.room && !g.moved) {
              if (
                Math.hypot(e.clientX - g.origin!.x, e.clientY - g.origin!.y) <=
                6
              )
                return;
              g.moved = true;
            }
            const dx = e.clientX - g.x,
              dy = e.clientY - g.y;
            setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
            g.x = e.clientX;
            g.y = e.clientY;
          } else if (g.kind === 'move') {
            const position = placement(
              { x: p.x + g.offset.x, y: p.y + g.offset.y },
              e,
            );
            emit(
              moveDeviceOnGrid(gridRef.current, g.key, position.x, position.y),
            );
          } else applyPaint(g, p);
        }}
        onPointerUp={(e) => {
          touches.current.delete(e.pointerId);
          if (gesture.current?.kind === 'pinch') {
            if (!touches.current.size) end(false);
          } else {
            const moved = gesture.current?.kind === 'move';
            const pickedRoom =
              gesture.current?.kind === 'pan' && !gesture.current.moved
                ? gesture.current.room
                : undefined;
            end(false);
            if (pickedRoom) onSelectRoom(pickedRoom);
            if (moved) onInspect();
          }
        }}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId);
          end(true);
        }}
        onLostPointerCapture={() => {
          if (gesture.current && touches.current.size === 0) end(true);
        }}
        onPointerLeave={() => {
          if (!gesture.current) setHover(null);
        }}
        onKeyDown={(e) => {
          let p = keyboardCell;
          const directions: Record<string, GridPoint> = {
            ArrowLeft: { x: -1, y: 0 },
            ArrowRight: { x: 1, y: 0 },
            ArrowUp: { x: 0, y: -1 },
            ArrowDown: { x: 0, y: 1 },
          };
          if (directions[e.key]) {
            e.preventDefault();
            p = {
              x: Math.max(
                0,
                Math.min(grid.width - 1, p.x + directions[e.key].x),
              ),
              y: Math.max(
                0,
                Math.min(grid.height - 1, p.y + directions[e.key].y),
              ),
            };
            onKeyboardCell(p);
          }
          if (e.key === 'Enter' && !disabled) {
            e.preventDefault();
            const before = gridRef.current;
            if (pending) {
              emit(
                placeSelectedDeviceOnGrid(before, pending, devices, p.x, p.y),
              );
              onSelect(pending);
              onPlaced();
            } else if (tool === 'rooms' && room)
              emit(
                applyGroupPoints(
                  before,
                  room,
                  [p],
                  roomErase ? 'erase' : 'paint',
                ),
              );
            else if (tool === 'walls' || tool === 'erase')
              emit(
                applyTilePoints(
                  before,
                  [p],
                  tool === 'erase' ? 'empty' : material,
                ),
              );
            onCommit(before);
          }
        }}
      />
      {background && !image && (
        <div className="fp-image-status" role={imageError ? 'alert' : 'status'}>
          {imageError ? (
            <>
              Background could not load.{' '}
              <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
            </>
          ) : (
            'Loading background…'
          )}
        </div>
      )}
      <div className="fp-canvas-controls">
        <div className="fp-zoom">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom out"
            onClick={() => zoom(1 / 1.2)}
          >
            <Minus />
          </Button>
          <Button variant="ghost" onClick={fit} title="Fit entire floorplan">
            {Math.round((view.scale / fitScale) * 100)}%
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom in"
            onClick={() => zoom(1.2)}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fit entire floorplan"
            onClick={fit}
          >
            <Maximize />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="View layers">
              <Layers3 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>View layers</DropdownMenuLabel>
            {(Object.keys(layers) as (keyof typeof layers)[]).map((key) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={layers[key]}
                onCheckedChange={(value) =>
                  setLayers((v) => ({ ...v, [key]: value }))
                }
              >
                {
                  {
                    grid: 'Tile grid',
                    rooms: 'Room areas',
                    devices: 'Device markers',
                    walls: 'Walls & tiles',
                  }[key]
                }
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <div className="p-2">
              <FloorplanLayerToggles
                label="Labels"
                value={floorplanLabels(grid)}
                onChange={(labelVisibility) => {
                  const before = gridRef.current;
                  emit({ ...before, labelVisibility });
                  onCommit(before);
                }}
              />
              <p className="mt-2 max-w-64 text-xs text-muted-foreground">
                Saved with this floorplan. Room labels also need the Room areas
                layer.
              </p>
            </div>
            {background && (
              <label className="block px-3 py-2 text-xs">
                Wall opacity{' '}
                <input
                  aria-label="Wall opacity"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={wallOpacity}
                  onChange={(e) => setWallOpacity(Number(e.target.value))}
                />
              </label>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="fp-canvas-hint">
        {hover
          ? `X ${hover.x.toFixed(1)} · Y ${hover.y.toFixed(1)}`
          : tool === 'select'
            ? 'Tap a room area to select · Drag to pan'
            : 'Wheel to zoom · Space + drag to pan'}
      </div>
    </div>
  );
}
