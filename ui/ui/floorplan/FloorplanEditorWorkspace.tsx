import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Brush,
  Check,
  Eraser,
  Hand,
  Image,
  Lightbulb,
  List,
  MapPin,
  MousePointer2,
  Radio,
  Redo2,
  Search,
  SlidersHorizontal,
  Square,
  Undo2,
  X,
  BrickWall,
  Layers3,
  Minus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { StatePreview } from '@/ui/settings/StatePreview';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/ui/primitives/dialog';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import {
  getFloorplanGroupFill,
  getFloorplanGroupStroke,
} from '@/lib/floorplanGroupColor';
import {
  cropGridState,
  getFloorplanContentBounds,
  removeDeviceFromGrid,
  resizeGridState,
  moveDeviceOnGrid,
  type FloorplanGrid,
  type AvailableFloorplanDevice,
  type TileType,
  type DrawShape,
  type GridPoint,
  type HorizontalResizeDirection,
  type VerticalResizeDirection,
} from '@/lib/floorplan-editor';
import {
  FloorplanEditorCanvas,
  tileColors,
  type EditorTool,
} from './FloorplanEditorCanvas';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { deepEqual } from '@/lib/configSection';
import { snapDevicePoint, type DeviceSnap } from '@/lib/floorplan-snapping';
import './floorplan-editor.css';
const tools = [
  { id: 'select', name: 'Select', icon: MousePointer2, key: 'V' },
  { id: 'devices', name: 'Devices', icon: Lightbulb, key: 'D' },
  { id: 'rooms', name: 'Rooms', icon: Layers3, key: 'R' },
  { id: 'walls', name: 'Walls', icon: BrickWall, key: 'B' },
  { id: 'erase', name: 'Erase', icon: Eraser, key: 'E' },
  { id: 'hand', name: 'Pan', icon: Hand, key: 'H' },
  { id: 'layout', name: 'Layout', icon: Image, key: '' },
] as const;
const shapes = [
  { id: 'freehand', name: 'Brush', icon: Brush },
  { id: 'line', name: 'Line', icon: Minus },
  { id: 'rectangle', name: 'Rectangle', icon: Square },
] as const;
function DevicePreview({ device }: { device?: AvailableFloorplanDevice }) {
  const p = device?.preview;
  const hex = p?.color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return p ? (
    <span className="fp-preview">
      <StatePreview
        color={
          hex
            ? {
                r: parseInt(hex[1], 16),
                g: parseInt(hex[2], 16),
                b: parseInt(hex[3], 16),
              }
            : undefined
        }
        brightness={p.brightness}
        power={p.power && !p.disabled}
        size={30}
      />
    </span>
  ) : (
    <span className="fp-sensor-preview">
      {device?.type === 'sensor' ? <Radio /> : <MapPin />}
    </span>
  );
}
export function FloorplanEditorWorkspace({
  grid,
  onChange,
  devices,
  groups,
  background,
  name,
  layoutContent,
  disabled,
  error,
  children,
  initialTool,
  revealLayout,
  historyEpoch,
}: {
  grid: FloorplanGrid | null;
  onChange: (g: FloorplanGrid) => void;
  devices: AvailableFloorplanDevice[];
  groups: { id: string; name: string; device_keys?: string[] | null }[];
  background?: string;
  name: string;
  layoutContent: ReactNode;
  disabled: boolean;
  error?: string;
  children?: ReactNode;
  initialTool?: EditorTool;
  revealLayout: number;
  historyEpoch: number;
}) {
  const [tool, setTool] = useState<EditorTool>(initialTool ?? 'select'),
    [material, setMaterial] = useState<TileType>('wall'),
    [shape, setShape] = useState<DrawShape>('freehand'),
    [room, setRoom] = useState(groups[0]?.id ?? ''),
    [roomErase, setRoomErase] = useState(false),
    [snap, setSnap] = useState<DeviceSnap>(0.25),
    [selected, setSelected] = useState<string | null>(null),
    [centerTarget, setCenterTarget] = useState<{
      key: string;
      serial: number;
    } | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [groupFilter, setGroupFilter] = useState<string | null>(null),
    [tray, setTray] = useState<'library' | 'inspector' | null>(
      initialTool === 'layout' && window.innerWidth < 900 ? 'library' : null,
    ),
    [library, setLibrary] = useState(true),
    [inspector, setInspector] = useState(true),
    [undo, setUndo] = useState<FloorplanGrid[]>([]),
    [redo, setRedo] = useState<FloorplanGrid[]>([]),
    [keyboardCell, setKeyboardCell] = useState<GridPoint>({ x: 0, y: 0 }),
    [resize, setResize] = useState(false),
    [dimensions, setDimensions] = useState({
      width: grid?.width ?? 64,
      height: grid?.height ?? 64,
    }),
    [horizontal, setHorizontal] = useState<HorizontalResizeDirection>('right'),
    [vertical, setVertical] = useState<VerticalResizeDirection>('bottom'),
    [dimensionError, setDimensionError] = useState('');
  const { advanced } = useSettingsPreferences(),
    gridRef = useRef(grid);
  gridRef.current = grid;
  const emit = (next: FloorplanGrid) => {
    gridRef.current = next;
    onChange(next);
  };
  const commit = (before: FloorplanGrid) => {
    if (!deepEqual(before, gridRef.current)) {
      setUndo((stack) => [...stack.slice(-49), before]);
      setRedo([]);
    }
  };
  const discrete = (next: FloorplanGrid | null) => {
    if (!next || !gridRef.current) return;
    const before = gridRef.current;
    emit(next);
    commit(before);
  };
  useEffect(() => {
    setUndo([]);
    setRedo([]);
    setPending(null);
  }, [historyEpoch]);
  const undoAction = () => {
    if (disabled || !gridRef.current || !undo.length) return;
    const current = gridRef.current;
    setRedo((stack) => [...stack, current]);
    emit(undo.at(-1)!);
    setUndo((stack) => stack.slice(0, -1));
  };
  const redoAction = () => {
    if (disabled || !gridRef.current || !redo.length) return;
    const current = gridRef.current;
    setUndo((stack) => [...stack, current]);
    emit(redo.at(-1)!);
    setRedo((stack) => stack.slice(0, -1));
  };
  useEffect(() => {
    if (revealLayout) {
      setTool('layout');
      setLibrary(true);
      if (window.innerWidth < 900) setTray('library');
      requestAnimationFrame(() =>
        document.getElementById('floorplan-name')?.focus(),
      );
    }
  }, [revealLayout]);
  const chooseTool = (value: EditorTool) => {
    if (value === 'erase' && tool === 'rooms') {
      setRoomErase((v) => !v);
      return;
    }
    if (value === 'erase' && tool === 'erase') value = 'walls';
    setTool(value);
    setSearch('');
    setPending(null);
    if (value === 'rooms' && shape === 'line') setShape('freehand');
    if (window.innerWidth < 900)
      setTray(['select', 'hand'].includes(value) ? null : 'library');
  };
  useEffect(() => {
    if (!room && groups.length) setRoom(groups[0].id);
  }, [groups, room]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        disabled ||
        (e.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"],[role="dialog"],[role="combobox"],[role="listbox"],[role="menu"]',
        )
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoAction();
        else undoAction();
        return;
      }
      if (e.key === 'Escape') {
        setPending(null);
        setTray(null);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      if (
        e.key.toLowerCase() === 'f' &&
        ['rooms', 'walls', 'erase'].includes(tool)
      ) {
        e.preventDefault();
        setShape((s) => (s === 'freehand' ? 'rectangle' : 'freehand'));
        return;
      }
      const next = tools.find(
        (t) => t.key && t.key.toLowerCase() === e.key.toLowerCase(),
      );
      if (next) {
        e.preventDefault();
        chooseTool(next.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const placement = grid?.devices.find((d) => d.deviceKey === selected),
    info = devices.find((d) => d.key === selected),
    selectedRoom = groups.find((g) => g.id === room),
    roomPoints = grid?.groups[room] ?? [];
  const mode = tool === 'select' || tool === 'hand' ? 'devices' : tool;
  const togglePanel = (which: 'library' | 'inspector') => {
    if (window.innerWidth < 900)
      setTray((current) => (current === which ? null : which));
    else if (which === 'library') setLibrary((v) => !v);
    else setInspector((v) => !v);
  };
  const shapeControls = (
    <div className="fp-segmented">
      {shapes
        .filter((s) => tool !== 'rooms' || s.id !== 'line')
        .map((s) => (
          <Button
            key={s.id}
            variant="ghost"
            title={`${s.name}${s.id !== 'line' ? ' · F toggles brush / rectangle' : ''}`}
            aria-label={s.name}
            aria-pressed={shape === s.id}
            onClick={() => setShape(s.id)}
            className={shape === s.id ? 'active' : ''}
          >
            <s.icon />
            <span>{s.name}</span>
          </Button>
        ))}
    </div>
  );
  const matches = (d: AvailableFloorplanDevice) =>
    `${d.name} ${d.key}`.toLowerCase().includes(search.toLowerCase()) &&
    (filter === 'all' || d.type === filter) &&
    (groupFilter === null || d.groupIds.includes(groupFilter));
  let allRoomsValue = '__floorplan_all_rooms__';
  while (groups.some((g) => g.id === allRoomsValue)) allRoomsValue += '_';
  const catalog = devices.filter(matches);
  const placedKeys = new Set(grid?.devices.map((d) => d.deviceKey));
  const selectDevice = (key: string) => {
    setSelected(key);
    setTool('devices');
    if (!placedKeys.has(key)) {
      setPending(key);
      setTray(null);
    } else {
      setPending(null);
      setCenterTarget((current) => ({
        key,
        serial: (current?.serial ?? 0) + 1,
      }));
      setInspector(true);
      setTray('inspector');
    }
  };
  const deviceRow = (d: AvailableFloorplanDevice, missing = false) => (
    <Button
      key={d.key}
      data-device-key={d.key}
      data-placed={placedKeys.has(d.key)}
      variant="ghost"
      className={`fp-entity ${selected === d.key ? 'active' : ''}`}
      onClick={() => selectDevice(d.key)}
    >
      <DevicePreview device={missing ? undefined : d} />
      <span>
        <strong>{d.name}</strong>
        <small>
          {missing
            ? 'Unavailable · placement retained'
            : (groups.find((g) => d.groupIds.includes(g.id))?.name ??
              (d.type === 'sensor' ? 'Sensor' : 'Device'))}
          {placedKeys.has(d.key) ? ' · placed' : ''}
        </small>
      </span>
      {placedKeys.has(d.key) ? (
        selected === d.key ? (
          <Check />
        ) : (
          <MapPin />
        )
      ) : (
        <span className="fp-add">+</span>
      )}
    </Button>
  );
  const showResize = () => {
    if (!grid) return;
    setDimensions({ width: grid.width, height: grid.height });
    setDimensionError('');
    setResize(true);
  };
  const validSize =
    Number.isInteger(dimensions.width) &&
    Number.isInteger(dimensions.height) &&
    dimensions.width >= 1 &&
    dimensions.height >= 1 &&
    dimensions.width <= 1024 &&
    dimensions.height <= 1024 &&
    dimensions.width * dimensions.height <= 1_000_000;
  const resized =
    grid && validSize && resize
      ? resizeGridState(
          grid,
          dimensions.width,
          dimensions.height,
          horizontal,
          vertical,
        )
      : null;
  const areaCount = (value: FloorplanGrid) =>
    Object.values(value.groups).reduce((n, points) => n + points.length, 0);
  return (
    <div className="fp-editor" data-tool={tool}>
      <div className="fp-options">
        <div className="fp-history">
          <Button
            variant="ghost"
            size="icon"
            title="Undo · Ctrl Z"
            aria-label="Undo"
            disabled={!undo.length || disabled}
            onClick={undoAction}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Redo · Ctrl Shift Z"
            aria-label="Redo"
            disabled={!redo.length || disabled}
            onClick={redoAction}
          >
            <Redo2 />
          </Button>
        </div>
        <div className="fp-context">
          <span className="fp-tool-title">
            {
              {
                select: 'Select & move',
                devices: 'Device placement',
                rooms: 'Room area',
                walls: 'Walls & tiles',
                erase: 'Erase tiles',
                hand: 'Pan canvas',
                layout: 'Layout & background',
              }[tool]
            }
          </span>
          {['rooms', 'walls', 'erase'].includes(tool) && (
            <>
              {shapeControls}
              {tool === 'rooms' ? (
                <Button
                  variant="ghost"
                  className={roomErase ? 'active' : ''}
                  aria-pressed={roomErase}
                  title="Toggle erase · E"
                  onClick={() => setRoomErase((v) => !v)}
                >
                  <Eraser />
                  <span>Erase</span>
                </Button>
              ) : (
                <span className="fp-material-name">
                  {tool === 'erase' ? 'Empty' : material}
                </span>
              )}
            </>
          )}
          {['select', 'devices', 'hand'].includes(tool) && (
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <span>Snap</span>
              <SettingsSelect
                aria-label="Device snapping"
                className="h-8 w-28"
                value={String(snap)}
                onValueChange={(v) => setSnap(Number(v) as DeviceSnap)}
                options={[
                  { value: '0', label: 'Free' },
                  { value: '1', label: 'Grid' },
                  { value: '0.25', label: '¼ grid' },
                ]}
              />
            </label>
          )}
        </div>
        <div className="fp-panel-buttons">
          <Button
            variant="ghost"
            size="icon"
            title="Toggle library"
            aria-label="Toggle library"
            aria-expanded={
              window.innerWidth < 900 ? tray === 'library' : library
            }
            onClick={() => togglePanel('library')}
          >
            <List />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Toggle properties"
            aria-label="Toggle properties"
            aria-expanded={
              window.innerWidth < 900 ? tray === 'inspector' : inspector
            }
            onClick={() => togglePanel('inspector')}
          >
            <SlidersHorizontal />
          </Button>
        </div>
      </div>
      <div className="fp-workspace" inert={disabled}>
        <nav className="fp-tools" aria-label="Editor tools">
          {tools.map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              title={`${t.name}${t.key ? ' · ' + t.key : ''}`}
              aria-label={`${t.name} tool`}
              aria-pressed={
                tool === t.id ||
                (t.id === 'erase' && tool === 'rooms' && roomErase)
              }
              className={
                tool === t.id ||
                (t.id === 'erase' && tool === 'rooms' && roomErase)
                  ? 'active'
                  : ''
              }
              disabled={disabled}
              onClick={() => chooseTool(t.id)}
            >
              <t.icon />
              <span>{t.name}</span>
            </Button>
          ))}
        </nav>
        <aside
          className={`fp-panel fp-library ${!library ? 'fp-collapsed' : ''} ${tray === 'library' ? 'fp-open' : ''}`}
          aria-label="Editor library"
        >
          <div className="fp-panel-heading">
            <div>
              <span className="fp-eyebrow">
                {
                  {
                    devices: 'PLACE & ORGANIZE',
                    rooms: 'PAINT ROOM MASKS',
                    walls: 'DRAW THE FLOORPLAN',
                    erase: 'REMOVE FROM LAYOUT',
                    layout: 'DOCUMENT SETTINGS',
                  }[mode]
                }
              </span>
              <h1>
                {
                  {
                    devices: 'Devices',
                    rooms: 'Room areas',
                    walls: 'Walls & tiles',
                    erase: 'Erase',
                    layout: 'Layout',
                  }[mode]
                }
              </h1>
            </div>
            <Button
              className="fp-tray-close"
              variant="ghost"
              size="icon"
              aria-label="Close library"
              onClick={() => setTray(null)}
            >
              <X />
            </Button>
          </div>
          <div className="fp-panel-content">
            {mode === 'devices' ? (
              <>
                <label className="fp-search">
                  <Search />
                  <Input
                    aria-label="Find a device"
                    placeholder="Find a device…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="fp-filters">
                  {[
                    ['all', 'All'],
                    ['controllable', 'Lights'],
                    ['sensor', 'Sensors'],
                  ].map(([id, label]) => (
                    <Button
                      key={id}
                      variant="ghost"
                      className={filter === id ? 'active' : ''}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <SettingsSelect
                  aria-label="Filter devices by room"
                  value={groupFilter ?? allRoomsValue}
                  onValueChange={(v) =>
                    setGroupFilter(v === allRoomsValue ? null : v)
                  }
                  options={[
                    { value: allRoomsValue, label: 'All rooms & groups' },
                    ...groups.map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
                <div className="fp-section-label">
                  To place{' '}
                  <span>
                    {catalog.filter((d) => !placedKeys.has(d.key)).length}
                  </span>
                </div>
                {catalog
                  .filter((d) => !placedKeys.has(d.key))
                  .map((d) => deviceRow(d))}
                <div className="fp-section-label">
                  Placed{' '}
                  <span>
                    {catalog.filter((d) => placedKeys.has(d.key)).length}
                  </span>
                </div>
                {catalog
                  .filter((d) => placedKeys.has(d.key))
                  .map((d) => deviceRow(d))}
                {grid?.devices
                  .filter(
                    (p) =>
                      !devices.some((d) => d.key === p.deviceKey) &&
                      `${p.deviceName} ${p.deviceKey}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map((p) =>
                    deviceRow(
                      {
                        key: p.deviceKey,
                        name: p.deviceName,
                        type: 'other',
                        groupIds: [],
                      },
                      true,
                    ),
                  )}
                <p className="fp-note">
                  Choose a device to place it. Drag a placed marker to move it.
                  Editing never controls devices.
                </p>
              </>
            ) : mode === 'rooms' ? (
              <>
                <label className="fp-search">
                  <Search />
                  <Input
                    aria-label="Find a room"
                    placeholder="Find a room or group…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <p className="fp-explanation">
                  Paint where a room belongs. Its membership stays unchanged.
                </p>
                {[
                  ...groups,
                  ...Object.keys(grid?.groups ?? {})
                    .filter((id) => !groups.some((g) => g.id === id))
                    .map((id) => ({ id, name: id })),
                ]
                  .filter((g) =>
                    `${g.name} ${g.id}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((g) => (
                    <Button
                      key={g.id}
                      variant="ghost"
                      className={`fp-entity ${room === g.id ? 'active' : ''}`}
                      onClick={() => {
                        setRoom(g.id);
                        setTray(null);
                      }}
                    >
                      <span
                        className="fp-room-swatch"
                        style={{
                          background: getFloorplanGroupFill(g.id),
                          color: getFloorplanGroupStroke(g.id),
                        }}
                      >
                        <Layers3 />
                      </span>
                      <span>
                        <strong>{g.name}</strong>
                        <small>
                          {grid?.groups[g.id]?.length ?? 0} tiles on this floor
                        </small>
                      </span>
                      {room === g.id && <Check />}
                    </Button>
                  ))}
                {!groups.length && (
                  <p className="fp-note">
                    <Link to="/config/groups">Create a room or group</Link>{' '}
                    before painting its area.
                  </p>
                )}
              </>
            ) : mode === 'walls' || mode === 'erase' ? (
              <>
                <p className="fp-explanation">
                  Draw the structure over the background. Shapes follow the tile
                  grid.
                </p>
                <div className="fp-section-label">Material</div>
                {(Object.keys(tileColors) as TileType[]).map((tile) => (
                  <Button
                    key={tile}
                    variant="ghost"
                    className={`fp-material ${(tool === 'erase' ? tile === 'empty' : material === tile) ? 'active' : ''}`}
                    disabled={tool === 'erase'}
                    onClick={() => setMaterial(tile)}
                  >
                    <span style={{ background: tileColors[tile] }} />
                    {tile}
                    {(tool === 'erase'
                      ? tile === 'empty'
                      : material === tile) && <Check />}
                  </Button>
                ))}
                {grid && (
                  <Button
                    variant="outline"
                    className="fp-fill"
                    onClick={async () => {
                      if (
                        await confirmDestructive(
                          'Fill all tiles?',
                          `All ${grid.width * grid.height} tiles will become ${tool === 'erase' ? 'empty' : material}. Devices and room areas are kept. You can undo this draft edit.`,
                          'Fill tiles',
                        )
                      )
                        discrete({
                          ...grid,
                          tiles: grid.tiles.map((row) =>
                            row.map(() =>
                              tool === 'erase' ? 'empty' : material,
                            ),
                          ),
                        });
                    }}
                  >
                    Fill all tiles…
                  </Button>
                )}
                <p className="fp-note">
                  Brush, line and rectangle each make one undo step. Middle-drag
                  or Space + drag pans with your tool still selected.
                </p>
              </>
            ) : (
              <>
                {layoutContent}
                {grid && (
                  <>
                    <div className="fp-section-heading">
                      <Square />
                      Grid
                    </div>
                    <div className="fp-metric">
                      <span>Dimensions</span>
                      <strong>
                        {grid.width} × {grid.height} tiles
                      </strong>
                    </div>
                    <div className="fp-small-actions">
                      <Button variant="outline" onClick={showResize}>
                        Resize…
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!getFloorplanContentBounds(grid)}
                        onClick={async () => {
                          const next = cropGridState(grid);
                          if (
                            next &&
                            (await confirmDestructive(
                              'Crop grid to its content?',
                              `Grid becomes ${next.width} × ${next.height} tiles. Placements and areas shift with the crop; the background still fills the entire grid. This draft edit can be undone.`,
                              'Crop grid',
                            ))
                          )
                            discrete(next);
                        }}
                      >
                        Auto crop
                      </Button>
                    </div>
                    <div className="fp-section-heading">
                      <Lightbulb />
                      Markers
                    </div>
                    <label className="fp-field">
                      Marker size · {Math.round(grid.deviceScale * 100)}%
                      <Input
                        aria-label="Marker size"
                        type="range"
                        min=".5"
                        max="3"
                        step=".1"
                        value={grid.deviceScale}
                        onChange={(e) =>
                          discrete({
                            ...grid,
                            deviceScale: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="fp-field">
                      Labels
                      <SettingsSelect
                        aria-label="Marker labels"
                        value={grid.labelMode ?? 'sensors'}
                        onValueChange={(v) =>
                          discrete({
                            ...grid,
                            labelMode: v as FloorplanGrid['labelMode'],
                          })
                        }
                        options={(
                          ['none', 'sensors', 'lights', 'all'] as const
                        ).map((value) => ({
                          value,
                          label: {
                            none: 'No labels',
                            sensors: 'Sensors',
                            lights: 'Lights',
                            all: 'All devices',
                          }[value],
                        }))}
                      />
                    </label>
                    {advanced && (
                      <label className="fp-field">
                        Tile size · pixels
                        <Input
                          type="number"
                          aria-label="Tile size"
                          key={grid.tileSize}
                          defaultValue={grid.tileSize}
                          min="1"
                          step="1"
                          onBlur={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n > 0)
                              discrete({ ...grid, tileSize: n });
                            else e.target.value = String(grid.tileSize);
                          }}
                        />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </aside>
        {grid ? (
          <FloorplanEditorCanvas
            grid={grid}
            onChange={emit}
            onCommit={commit}
            devices={devices}
            groups={groups}
            tool={tool}
            material={material}
            shape={shape}
            room={room}
            roomErase={roomErase}
            selected={selected}
            centerTarget={centerTarget}
            onSelect={setSelected}
            onInspect={() => {
              setInspector(true);
              setTray('inspector');
            }}
            pending={pending}
            onPlaced={() => {
              setPending(null);
              setInspector(true);
              setTray('inspector');
            }}
            background={background}
            name={name}
            tray={tray}
            disabled={disabled}
            keyboardCell={keyboardCell}
            onKeyboardCell={setKeyboardCell}
            snap={snap}
          />
        ) : (
          <div className="fp-stage fp-unavailable" role="alert">
            <h2>Layout unavailable</h2>
            <p>{error}</p>
            <p>
              Its content is retained. Download it for inspection, or import a
              supported layout from the document menu. Name and image edits
              preserve the layout.
            </p>
            <Button variant="outline" onClick={() => chooseTool('layout')}>
              Open layout properties
            </Button>
          </div>
        )}
        <aside
          className={`fp-panel fp-inspector ${!inspector ? 'fp-collapsed' : ''} ${tray === 'inspector' ? 'fp-open' : ''}`}
          aria-label="Selection properties"
        >
          <div className="fp-panel-heading">
            <div>
              <span className="fp-eyebrow">PROPERTIES</span>
              <h2>
                {tool === 'rooms'
                  ? 'Room area'
                  : tool === 'walls' || tool === 'erase'
                    ? 'Drawing'
                    : tool === 'layout'
                      ? 'Document'
                      : 'Placement'}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close properties"
              onClick={() => {
                setTray(null);
                setInspector(false);
              }}
            >
              <X />
            </Button>
          </div>
          <div className="fp-panel-content">
            {tool === 'rooms' ? (
              <>
                <div className="fp-selection">
                  <span
                    className="fp-room-swatch"
                    style={{ background: getFloorplanGroupFill(room) }}
                  >
                    <Layers3 />
                  </span>
                  <div>
                    <strong>
                      {selectedRoom?.name ?? (room || 'Choose a room')}
                    </strong>
                    <small>Area on {name}</small>
                  </div>
                </div>
                <div className="fp-section-heading">
                  <Brush />
                  Paint area
                </div>
                {shapeControls}
                <div className="fp-metric">
                  <span>Area</span>
                  <strong>{roomPoints.length} tiles</strong>
                </div>
                <div className="fp-metric">
                  <span>Placed member devices</span>
                  <strong>
                    {grid?.devices.filter((p) =>
                      devices
                        .find((d) => d.key === p.deviceKey)
                        ?.groupIds.includes(room),
                    ).length ?? 0}
                  </strong>
                </div>
                <p className="fp-note">
                  Painting changes only this floorplan mask. Devices and room
                  membership stay unchanged.
                </p>
                {selectedRoom && (
                  <Link
                    className="fp-related"
                    to={`/config/groups/${encodeURIComponent(room)}`}
                  >
                    Open room settings
                    <ArrowRight />
                  </Link>
                )}
                {grid && roomPoints.length > 0 && (
                  <Button
                    variant="ghost"
                    className="fp-remove"
                    onClick={async () => {
                      if (
                        await confirmDestructive(
                          'Remove this room area?',
                          'Only its mask on this floorplan is removed. The room and its devices remain.',
                          'Remove area',
                        )
                      ) {
                        const groups = { ...grid.groups };
                        delete groups[room];
                        discrete({ ...grid, groups });
                      }
                    }}
                  >
                    <Trash2 />
                    Remove area from this floor
                  </Button>
                )}
              </>
            ) : tool === 'walls' || tool === 'erase' ? (
              <>
                <div className="fp-selection">
                  <BrickWall />
                  <div>
                    <strong>
                      {tool === 'erase' ? 'Erase tiles' : material}
                    </strong>
                    <small>Tile aligned</small>
                  </div>
                </div>
                <div className="fp-section-heading">
                  <Square />
                  Shape
                </div>
                {shapeControls}
                <p className="fp-note">
                  A complete stroke is one undo step. Arrow keys move the
                  focused tile; Enter paints it. Use the Hand tool or Space +
                  drag to pan.
                </p>
              </>
            ) : tool === 'layout' ? (
              <>
                <div className="fp-metric">
                  <span>Placed devices</span>
                  <strong>{grid?.devices.length ?? 0}</strong>
                </div>
                <div className="fp-metric">
                  <span>Room areas</span>
                  <strong>{Object.keys(grid?.groups ?? {}).length}</strong>
                </div>
                <p className="fp-note">
                  Name, background and layout save together. View layers, pan
                  and zoom do not change the document.
                </p>
                <Link className="fp-related" to="/map">
                  Open normal map
                  <ArrowRight />
                </Link>
              </>
            ) : placement ? (
              <>
                <div className="fp-selection">
                  <DevicePreview device={info} />
                  <div>
                    <strong>{info?.name ?? placement.deviceName}</strong>
                    <small>
                      {info
                        ? 'Placed on this floor'
                        : 'Unavailable · saved placement'}
                    </small>
                  </div>
                </div>
                <div className="fp-section-heading">
                  <MapPin />
                  Position · tiles
                </div>
                <div className="fp-fields">
                  {(['x', 'y'] as const).map((axis) => (
                    <label key={axis} className="fp-field">
                      {axis.toUpperCase()}
                      <Input
                        key={`${axis}/${placement[axis]}`}
                        aria-label={`Placement ${axis.toUpperCase()}`}
                        type="number"
                        step={snap || 0.1}
                        min="0"
                        max={
                          (axis === 'x' ? grid!.width : grid!.height) - 0.001
                        }
                        defaultValue={placement[axis]}
                        onBlur={(e) => {
                          const n = Number(e.target.value),
                            limit = axis === 'x' ? grid!.width : grid!.height;
                          if (Number.isFinite(n) && n >= 0 && n < limit)
                            discrete(
                              moveDeviceOnGrid(
                                grid!,
                                placement.deviceKey,
                                axis === 'x' ? n : placement.x,
                                axis === 'y' ? n : placement.y,
                              ),
                            );
                          else e.target.value = String(placement[axis]);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <p className="fp-explanation">
                  Alt: free placement · Shift: ¼ grid. Typed coordinates stay
                  exact.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!snap || disabled}
                  onClick={() => {
                    const p = snapDevicePoint(
                      placement,
                      grid!.width,
                      grid!.height,
                      snap,
                    );
                    discrete(
                      moveDeviceOnGrid(grid!, placement.deviceKey, p.x, p.y),
                    );
                  }}
                >
                  Snap to {snap === 1 ? 'grid' : '¼ grid'}
                </Button>
                {info?.preview && (
                  <>
                    <div className="fp-section-heading">
                      <Lightbulb />
                      Preview
                    </div>
                    <div className="fp-metric">
                      <span>Live state</span>
                      <strong>
                        {info.preview.disabled
                          ? 'Disabled'
                          : info.preview.power
                            ? 'On'
                            : 'Off'}{' '}
                        · {Math.round(info.preview.brightness * 100)}%
                      </strong>
                    </div>
                  </>
                )}
                <Link
                  className="fp-related"
                  to={`/config/devices/detail/${encodeURIComponent(placement.deviceKey)}`}
                >
                  Open device settings
                  <ArrowRight />
                </Link>
                <Button
                  variant="ghost"
                  className="fp-remove"
                  onClick={() =>
                    discrete(removeDeviceFromGrid(grid!, placement.deviceKey))
                  }
                >
                  <Trash2 />
                  Remove placement
                </Button>
                {advanced && (
                  <div className="fp-key">{placement.deviceKey}</div>
                )}
              </>
            ) : (
              <p className="fp-note">
                {pending
                  ? 'Click or tap the canvas to place the selected device. Escape cancels.'
                  : 'Select a placed marker to inspect its position, or choose an unplaced device from the library.'}
              </p>
            )}
          </div>
        </aside>
      </div>
      <footer className="fp-status">
        <span>{tools.find((t) => t.id === tool)?.name}</span>
        <span>
          {['rooms', 'walls', 'erase'].includes(tool)
            ? 'F: brush / rectangle · E: erase · '
            : 'Alt: free · Shift: ¼ grid · '}
          Wheel to zoom · Space + drag to pan
        </span>
        <span>
          {grid ? `${grid.width} × ${grid.height} tiles` : 'Layout retained'}
        </span>
      </footer>
      {children}
      <Dialog open={resize} onOpenChange={setResize}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resize grid</DialogTitle>
            <DialogDescription>
              Choose the new size and the edges that grow or shrink. The
              background continues to fill the grid.
            </DialogDescription>
          </DialogHeader>
          <div className="fp-fields">
            {(['width', 'height'] as const).map((axis) => (
              <label className="fp-field" key={axis}>
                {axis}
                <Input
                  aria-label={`Grid ${axis}`}
                  type="number"
                  min="1"
                  max="1024"
                  value={dimensions[axis]}
                  onChange={(e) =>
                    setDimensions((d) => ({
                      ...d,
                      [axis]: Number(e.target.value),
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <label className="fp-field">
            Horizontal edge
            <SettingsSelect
              value={horizontal}
              onValueChange={(v) =>
                setHorizontal(v as HorizontalResizeDirection)
              }
              options={[
                { value: 'right', label: 'Right' },
                { value: 'left', label: 'Left' },
              ]}
            />
          </label>
          <label className="fp-field">
            Vertical edge
            <SettingsSelect
              value={vertical}
              onValueChange={(v) => setVertical(v as VerticalResizeDirection)}
              options={[
                { value: 'bottom', label: 'Bottom' },
                { value: 'top', label: 'Top' },
              ]}
            />
          </label>
          {resized && grid && (
            <p className="fp-resize-preview">
              {grid.width} × {grid.height} → {resized.width} × {resized.height}{' '}
              tiles
              <br />
              Placements shift X{' '}
              {horizontal === 'left' ? dimensions.width - grid.width : 0}, Y{' '}
              {vertical === 'top' ? dimensions.height - grid.height : 0}.<br />
              {grid.devices.length - resized.devices.length} placements and{' '}
              {areaCount(grid) - areaCount(resized)} room-area tiles leave the
              grid. This draft edit can be undone.
            </p>
          )}
          {(!validSize || dimensionError) && (
            <p role="alert" className="text-sm text-destructive">
              {dimensionError ||
                'Use whole dimensions from 1 to 1024, with at most one million tiles.'}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResize(false)}>
              Cancel
            </Button>
            <Button
              disabled={!validSize}
              onClick={() => {
                if (resized) discrete(resized);
                setResize(false);
              }}
            >
              Apply resize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
