import { cn } from '@/lib/cn';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';

type EditorMode = 'tiles' | 'devices' | 'groups';
type TileType = 'floor' | 'wall' | 'door' | 'window';

const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const rangeClassName =
  'h-2 cursor-pointer appearance-none rounded-full bg-muted accent-primary';
const toolbarPanelClassName =
  'rounded-2xl border border-border bg-muted/30 px-3 py-2';

export function FloorplanModeBar({
  mode,
  canUndo,
  canAutoCrop,
  onModeChange,
  onUndo,
  onAutoCrop,
}: {
  mode: EditorMode;
  canUndo: boolean;
  canAutoCrop: boolean;
  onModeChange: (mode: EditorMode) => void;
  onUndo: () => void;
  onAutoCrop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex w-fit rounded-2xl bg-muted p-1">
        <Button
          variant={mode === 'tiles' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onModeChange('tiles')}
        >
          Draw Walls
        </Button>
        <Button
          variant={mode === 'devices' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onModeChange('devices')}
        >
          Place Devices
        </Button>
        <Button
          variant={mode === 'groups' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onModeChange('groups')}
        >
          Paint Groups
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canUndo}
          onClick={onUndo}
        >
          Undo
          <span className="text-xs text-muted-foreground">Ctrl/Cmd+Z</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={!canAutoCrop}
          onClick={onAutoCrop}
        >
          Auto Crop
        </Button>
      </div>
    </div>
  );
}

export function FloorplanDeviceScaleControl({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-3', toolbarPanelClassName)}
    >
      <span className="text-sm font-medium">Device scale</span>
      <input
        type="range"
        className={cn(rangeClassName, 'w-40')}
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
      />
      <Input
        type="number"
        className="h-9 w-20"
        min={min}
        max={max}
        step={0.1}
        value={value.toFixed(1)}
        onChange={(event) => onChange(parseFloat(event.target.value))}
      />
      <span className="text-sm text-muted-foreground">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export function FloorplanBackgroundControls({
  mode,
  showGrid,
  gridOpacity,
  onShowGridChange,
  onGridOpacityChange,
}: {
  mode: EditorMode;
  showGrid: boolean;
  gridOpacity: number;
  onShowGridChange: (value: boolean) => void;
  onGridOpacityChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className={checkboxClassName}
          checked={showGrid}
          onChange={(event) => onShowGridChange(event.target.checked)}
        />
        <span className="text-sm">Show walls overlay</span>
      </label>
      {showGrid ? (
        <label className="flex items-center gap-2">
          <span className="text-sm">Opacity:</span>
          <input
            type="range"
            className={cn(rangeClassName, 'w-24')}
            min={0.1}
            max={1}
            step={0.1}
            value={gridOpacity}
            onChange={(event) =>
              onGridOpacityChange(parseFloat(event.target.value))
            }
          />
        </label>
      ) : null}
      <div className="text-sm text-muted-foreground">
        {mode === 'tiles'
          ? 'Trace walls, doors, and windows directly over the background image'
          : mode === 'groups'
            ? 'Paint group areas directly on the background image'
            : 'Place devices directly on the background image'}
      </div>
    </div>
  );
}

export function FloorplanLegend({
  tileColors,
  tileLabels,
}: {
  tileColors: Record<TileType, string>;
  tileLabels: Record<TileType, string>;
}) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {(Object.keys(tileColors) as TileType[]).map((type) => (
        <div key={type} className="flex items-center gap-1">
          <span
            className="size-4 rounded border border-border"
            style={{ backgroundColor: tileColors[type] }}
          />
          <span className="text-muted-foreground">{tileLabels[type]}</span>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <span className="size-4 rounded-full bg-emerald-500" />
        <span className="text-muted-foreground">Device</span>
      </div>
    </div>
  );
}
