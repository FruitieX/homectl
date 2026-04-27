import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';

import {
  getDashboardWidgetOptionString,
  type DashboardWidget,
  widgetRegistry,
} from '@/hooks/useDashboard';
import { cn } from '@/lib/cn';
import {
  clampDashboardWidgetHeight,
  clampDashboardWidgetWidth,
  DASHBOARD_COMPACT_COLUMNS,
  DASHBOARD_GRID_HELP,
  DASHBOARD_MAX_ROWS,
  DASHBOARD_MOBILE_COLUMNS,
  DASHBOARD_WIDE_COLUMNS,
} from '@/lib/dashboard-layout';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';

const GRID_ROW_HEIGHT_PX = 160;
const DRAG_THRESHOLD_PX = 6;

type PreviewColumnCount =
  | typeof DASHBOARD_MOBILE_COLUMNS
  | typeof DASHBOARD_COMPACT_COLUMNS
  | typeof DASHBOARD_WIDE_COLUMNS;

const PREVIEW_COLUMN_OPTIONS: PreviewColumnCount[] = [
  DASHBOARD_MOBILE_COLUMNS,
  DASHBOARD_COMPACT_COLUMNS,
  DASHBOARD_WIDE_COLUMNS,
];

type GridInteraction =
  | {
      id: string;
      kind: 'drag';
      startClientX: number;
      startClientY: number;
      hasMoved: boolean;
    }
  | {
      id: string;
      kind: 'resize';
      startClientX: number;
      startClientY: number;
      startWidth: number;
      startHeight: number;
      columns: PreviewColumnCount;
      cellWidth: number;
      cellHeight: number;
      columnGap: number;
      rowGap: number;
    };

interface DashboardGridEditorProps {
  widgets: DashboardWidget[];
  onEdit: (widget: DashboardWidget) => void;
  onRemove: (widget: DashboardWidget) => void;
  onUpdateWidget: (
    id: string,
    widget: Partial<DashboardWidget>,
  ) => Promise<DashboardWidget>;
  onReorderWidgets: (ids: string[]) => Promise<void>;
}

interface DropIndicator {
  insertionIndex: number;
  orientation: 'horizontal' | 'vertical';
  style: CSSProperties;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getGridColumnLabel(columns: PreviewColumnCount) {
  if (columns === DASHBOARD_MOBILE_COLUMNS) {
    return 'Phone · 4 columns';
  }

  if (columns === DASHBOARD_COMPACT_COLUMNS) {
    return '600px display · 6 columns';
  }

  return 'Large · 8 columns';
}

function sortWidgets(widgets: DashboardWidget[]) {
  return [...widgets].sort(
    (left, right) =>
      left.position - right.position || left.id.localeCompare(right.id),
  );
}

function getGridMetrics(grid: HTMLDivElement, columns: PreviewColumnCount) {
  const styles = window.getComputedStyle(grid);
  const columnGap = Number.parseFloat(styles.columnGap || '0') || 0;
  const rowGap = Number.parseFloat(styles.rowGap || '0') || columnGap;
  const contentWidth = Math.max(1, grid.getBoundingClientRect().width);
  const cellWidth = Math.max(
    1,
    (contentWidth - columnGap * (columns - 1)) / columns,
  );

  return {
    columns,
    cellWidth,
    cellHeight: GRID_ROW_HEIGHT_PX,
    columnGap,
    rowGap,
  };
}

function getAutoLayoutStyle(
  widget: DashboardWidget,
  columns: PreviewColumnCount,
) {
  const width = clampDashboardWidgetWidth(widget.width, columns);
  const height = clampDashboardWidgetHeight(widget.height);

  return {
    gridColumn: `span ${width} / span ${width}`,
    gridRow: `span ${height} / span ${height}`,
  };
}

function getWidgetIds(widgets: DashboardWidget[]) {
  return widgets.map((widget) => widget.id);
}

function reorderWidgetIdsByInsertionIndex(
  widgets: DashboardWidget[],
  draggedId: string,
  insertionIndex: number,
) {
  const ids = getWidgetIds(widgets);
  const originalIndex = ids.indexOf(draggedId);

  if (originalIndex === -1) {
    return ids;
  }

  const nextIds = ids.filter((id) => id !== draggedId);
  const adjustedIndex = clamp(
    insertionIndex - (originalIndex < insertionIndex ? 1 : 0),
    0,
    nextIds.length,
  );
  nextIds.splice(adjustedIndex, 0, draggedId);

  return nextIds;
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function WidgetPreview({ widget }: { widget: DashboardWidget }) {
  if (widget.widget_type === 'clock') {
    return (
      <div className="grid h-full place-items-center rounded-2xl bg-muted/30 text-center">
        <div>
          <div className="font-mono text-3xl font-semibold tracking-tight">
            12:34
          </div>
          <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">
            Today · Calendar below
          </div>
        </div>
      </div>
    );
  }

  if (widget.widget_type === 'weather') {
    return (
      <div className="flex h-full items-center justify-between gap-3 rounded-2xl bg-sky-500/10 p-3">
        <div>
          <div className="text-3xl font-semibold">21°</div>
          <div className="text-xs text-muted-foreground">Partly cloudy</div>
        </div>
        <div className="flex h-14 items-end gap-1">
          {[32, 48, 40, 58, 46].map((height, index) => (
            <span
              key={index}
              className="w-2 rounded-full bg-sky-500/50"
              style={{ height }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (widget.widget_type === 'sensors') {
    return (
      <div className="flex h-full flex-wrap items-center justify-center gap-2 rounded-2xl bg-muted/30 p-3">
        {['Living 22°', 'Bedroom 21°', 'Outdoor 8°'].map((label) => (
          <span
            key={label}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs"
          >
            {label}
          </span>
        ))}
      </div>
    );
  }

  if (widget.widget_type === 'controls') {
    return (
      <div className="grid h-full grid-cols-2 gap-2 rounded-2xl bg-muted/30 p-3">
        {['Lights', 'Evening', 'Away', 'Off'].map((label) => (
          <span
            key={label}
            className="grid place-items-center rounded-xl bg-background text-xs font-medium shadow-sm"
          >
            {label}
          </span>
        ))}
      </div>
    );
  }

  if (widget.widget_type === 'spot_price') {
    return (
      <div className="flex h-full items-center justify-between rounded-2xl bg-amber-500/10 p-3">
        <div>
          <div className="text-2xl font-semibold">7.2 c/kWh</div>
          <div className="text-xs text-muted-foreground">Spot price</div>
        </div>
        <div className="h-12 w-20 rounded-xl bg-amber-500/20" />
      </div>
    );
  }

  if (widget.widget_type === 'train_schedule') {
    return (
      <div className="grid h-full gap-2 rounded-2xl bg-muted/30 p-3 text-xs">
        {[
          'K · leave in 5 min',
          'I · leave in 12 min',
          'P · leave in 19 min',
        ].map((label) => {
          const [line, time] = label.split(' · ');

          return (
            <div
              key={label}
              className="flex items-center justify-between rounded-xl bg-background px-3 py-1"
            >
              <span>{line}</span>
              <span className="text-muted-foreground">{time}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (widget.widget_type === 'text') {
    return (
      <div className="h-full rounded-2xl bg-muted/30 p-3 text-sm text-muted-foreground">
        {getDashboardWidgetOptionString(widget, 'body', 'Text widget preview')}
      </div>
    );
  }

  if (widget.widget_type === 'link') {
    return (
      <div className="grid h-full place-items-center rounded-2xl bg-primary/10 p-3 text-center">
        <div>
          <div className="font-semibold">
            {getDashboardWidgetOptionString(widget, 'label', 'Open')}
          </div>
          <div className="text-xs text-muted-foreground">
            {getDashboardWidgetOptionString(widget, 'url', '/')}
          </div>
        </div>
      </div>
    );
  }

  if (widget.widget_type === 'image') {
    const imageUrl = getDashboardWidgetOptionString(widget, 'imageUrl', '');
    return imageUrl ? (
      <img
        src={imageUrl}
        alt={getDashboardWidgetOptionString(widget, 'alt', widget.title)}
        className="h-full w-full rounded-2xl object-cover"
      />
    ) : (
      <div className="grid h-full place-items-center rounded-2xl bg-muted/30 text-xs text-muted-foreground">
        Image preview
      </div>
    );
  }

  if (widget.widget_type === 'iframe') {
    return (
      <div className="grid h-full place-items-center rounded-2xl bg-muted/30 p-3 text-center text-xs text-muted-foreground">
        <div>
          <div className="font-medium text-foreground">Embedded view</div>
          <div>
            {getDashboardWidgetOptionString(widget, 'url', 'No URL set')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full place-items-center rounded-2xl bg-muted/30 text-xs text-muted-foreground">
      Custom widget preview
    </div>
  );
}

export function DashboardGridEditor({
  widgets,
  onEdit,
  onRemove,
  onUpdateWidget,
  onReorderWidgets,
}: DashboardGridEditorProps) {
  const [previewColumns, setPreviewColumns] = useState<PreviewColumnCount>(
    DASHBOARD_WIDE_COLUMNS,
  );
  const [draftWidgets, setDraftWidgets] = useState(() => sortWidgets(widgets));
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(
    null,
  );
  const [savingWidgetId, setSavingWidgetId] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const interactionRef = useRef<GridInteraction | null>(null);
  const dropIndicatorRef = useRef<DropIndicator | null>(null);
  const draftWidgetsRef = useRef(draftWidgets);
  const initialOrderRef = useRef<string[]>([]);

  useEffect(() => {
    setDraftWidgets(sortWidgets(widgets));
  }, [widgets]);

  useEffect(() => {
    draftWidgetsRef.current = draftWidgets;
  }, [draftWidgets]);

  useEffect(() => {
    dropIndicatorRef.current = dropIndicator;
  }, [dropIndicator]);

  useEffect(() => {
    const buildDropIndicator = (
      draggedId: string,
      clientX: number,
      clientY: number,
    ): DropIndicator | null => {
      const grid = gridRef.current;
      if (!grid) {
        return null;
      }

      const gridRect = grid.getBoundingClientRect();
      let nearest: {
        id: string;
        index: number;
        rect: DOMRect;
      } | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const [index, widget] of draftWidgetsRef.current.entries()) {
        if (widget.id === draggedId) {
          continue;
        }

        const element = cardRefs.current.get(widget.id);
        if (!element) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        const inside =
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom;

        if (inside) {
          nearest = { id: widget.id, index, rect };
          nearestDistance = 0;
          continue;
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(clientX - centerX, clientY - centerY);

        if (distance < nearestDistance) {
          nearest = { id: widget.id, index, rect };
          nearestDistance = distance;
        }
      }

      if (!nearest) {
        return null;
      }

      const centerX = nearest.rect.left + nearest.rect.width / 2;
      const centerY = nearest.rect.top + nearest.rect.height / 2;
      const horizontalIntent =
        nearest.rect.width >= gridRect.width * 0.55 ||
        Math.abs(clientY - centerY) > Math.abs(clientX - centerX) * 1.15;
      const after = horizontalIntent ? clientY > centerY : clientX > centerX;
      const insertionIndex = nearest.index + (after ? 1 : 0);
      const indicatorGap = 6;

      if (horizontalIntent) {
        const top = clamp(
          (after ? nearest.rect.bottom : nearest.rect.top) -
            gridRect.top +
            (after ? indicatorGap : -indicatorGap),
          0,
          gridRect.height,
        );

        return {
          insertionIndex,
          orientation: 'horizontal',
          style: {
            left: nearest.rect.left - gridRect.left,
            top,
            width: nearest.rect.width,
            height: 4,
          },
        };
      }

      const left = clamp(
        (after ? nearest.rect.right : nearest.rect.left) -
          gridRect.left +
          (after ? indicatorGap : -indicatorGap),
        0,
        gridRect.width,
      );

      return {
        insertionIndex,
        orientation: 'vertical',
        style: {
          left,
          top: nearest.rect.top - gridRect.top,
          width: 4,
          height: nearest.rect.height,
        },
      };
    };

    const applyInteraction = (event: globalThis.PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) {
        return;
      }

      const deltaX = event.clientX - interaction.startClientX;
      const deltaY = event.clientY - interaction.startClientY;

      if (interaction.kind === 'drag') {
        const hasMoved =
          interaction.hasMoved ||
          Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX;
        interactionRef.current = { ...interaction, hasMoved };

        if (!hasMoved) {
          return;
        }

        setDropIndicator(
          buildDropIndicator(interaction.id, event.clientX, event.clientY),
        );
        return;
      }

      const columnDelta = Math.round(
        deltaX / (interaction.cellWidth + interaction.columnGap),
      );
      const rowDelta = Math.round(
        deltaY / (interaction.cellHeight + interaction.rowGap),
      );
      const nextWidth = clamp(
        interaction.startWidth + columnDelta,
        1,
        interaction.columns,
      );
      const nextHeight = clamp(
        interaction.startHeight + rowDelta,
        1,
        DASHBOARD_MAX_ROWS,
      );

      setDraftWidgets((currentWidgets) =>
        currentWidgets.map((widget) =>
          widget.id === interaction.id
            ? { ...widget, width: nextWidth, height: nextHeight }
            : widget,
        ),
      );
    };

    const finishInteraction = () => {
      const interaction = interactionRef.current;
      if (!interaction) {
        return;
      }

      interactionRef.current = null;
      setActiveWidgetId(null);
      setDropIndicator(null);
      setEditorError(null);

      if (interaction.kind === 'drag') {
        const indicator = dropIndicatorRef.current;
        if (!interaction.hasMoved || !indicator) {
          return;
        }

        const orderedIds = reorderWidgetIdsByInsertionIndex(
          draftWidgetsRef.current,
          interaction.id,
          indicator.insertionIndex,
        );
        if (sameIds(initialOrderRef.current, orderedIds)) {
          return;
        }

        setDraftWidgets((currentWidgets) => {
          const widgetMap = new Map(
            currentWidgets.map((widget) => [widget.id, widget]),
          );

          return orderedIds.flatMap((id, index) => {
            const widget = widgetMap.get(id);
            return widget ? [{ ...widget, position: index }] : [];
          });
        });
        setSavingWidgetId(interaction.id);
        void onReorderWidgets(orderedIds)
          .catch((error: unknown) => {
            setDraftWidgets(sortWidgets(widgets));
            setEditorError(
              error instanceof Error
                ? error.message
                : 'Failed to save dashboard order.',
            );
          })
          .finally(() => setSavingWidgetId(null));
        return;
      }

      const updatedWidget = draftWidgetsRef.current.find(
        (widget) => widget.id === interaction.id,
      );
      if (!updatedWidget) {
        return;
      }

      setSavingWidgetId(updatedWidget.id);
      void onUpdateWidget(updatedWidget.id, {
        width: updatedWidget.width,
        height: updatedWidget.height,
      })
        .catch((error: unknown) => {
          setDraftWidgets(sortWidgets(widgets));
          setEditorError(
            error instanceof Error
              ? error.message
              : 'Failed to save dashboard widget size.',
          );
        })
        .finally(() => setSavingWidgetId(null));
    };

    window.addEventListener('pointermove', applyInteraction);
    window.addEventListener('pointerup', finishInteraction);
    window.addEventListener('pointercancel', finishInteraction);

    return () => {
      window.removeEventListener('pointermove', applyInteraction);
      window.removeEventListener('pointerup', finishInteraction);
      window.removeEventListener('pointercancel', finishInteraction);
    };
  }, [onReorderWidgets, onUpdateWidget, widgets]);

  const startDrag = (
    event: PointerEvent<HTMLDivElement>,
    widget: DashboardWidget,
  ) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    initialOrderRef.current = getWidgetIds(draftWidgetsRef.current);
    setDropIndicator(null);
    interactionRef.current = {
      id: widget.id,
      kind: 'drag',
      startClientX: event.clientX,
      startClientY: event.clientY,
      hasMoved: false,
    };
    setActiveWidgetId(widget.id);
  };

  const startResize = (
    event: PointerEvent<HTMLButtonElement>,
    widget: DashboardWidget,
  ) => {
    if (event.button !== 0 || !gridRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const metrics = getGridMetrics(gridRef.current, previewColumns);

    setDropIndicator(null);
    interactionRef.current = {
      id: widget.id,
      kind: 'resize',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: clampDashboardWidgetWidth(widget.width, previewColumns),
      startHeight: clampDashboardWidgetHeight(widget.height),
      ...metrics,
    };
    setActiveWidgetId(widget.id);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-medium">Visual dashboard editor</div>
          <div className="text-xs text-muted-foreground">
            Drag from anywhere on a widget card to reorder. The dashboard
            auto-layouts cards by order and size, so widgets cannot overlap.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PREVIEW_COLUMN_OPTIONS.map((columns) => (
            <Button
              key={columns}
              size="sm"
              variant={previewColumns === columns ? 'default' : 'outline'}
              onClick={() => setPreviewColumns(columns)}
            >
              {getGridColumnLabel(columns)}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-dashed border-border bg-muted/20 p-3">
        <div className="mb-3 rounded-2xl bg-background/80 p-3 text-xs text-muted-foreground">
          {DASHBOARD_GRID_HELP}
        </div>
        {editorError ? (
          <div className="mb-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {editorError}
          </div>
        ) : null}
        <div className="overflow-x-auto pb-2">
          <div
            ref={gridRef}
            className="relative grid auto-rows-[10rem] grid-flow-row gap-3"
            style={{
              gridTemplateColumns: `repeat(${previewColumns}, minmax(0, 1fr))`,
              minWidth: `${previewColumns * 6}rem`,
            }}
          >
            {draftWidgets.map((widget) => (
              <Card
                key={widget.id}
                ref={(element) => {
                  if (element) {
                    cardRefs.current.set(widget.id, element);
                  } else {
                    cardRefs.current.delete(widget.id);
                  }
                }}
                className={cn(
                  'group relative min-w-0 overflow-hidden rounded-2xl bg-background/90 shadow-sm ring-1 ring-border transition hover:ring-primary/50',
                  activeWidgetId === widget.id &&
                    'z-10 scale-[1.01] cursor-grabbing ring-2 ring-primary shadow-lg',
                  savingWidgetId === widget.id && 'opacity-70',
                )}
                style={getAutoLayoutStyle(widget, previewColumns)}
              >
                <CardContent
                  className="flex h-full cursor-grab touch-none select-none flex-col gap-3 p-4 active:cursor-grabbing"
                  onPointerDown={(event) => startDrag(event, widget)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{widget.title}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {widgetRegistry[widget.widget_type]?.name ||
                          widget.widget_type}
                        <span className="ml-2">
                          {widget.width}×{widget.height}
                        </span>
                      </div>
                    </div>
                    <span className="rounded-xl border border-border bg-muted/60 px-2 py-1 text-xs font-medium text-muted-foreground">
                      #{widget.position + 1}
                    </span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden">
                    <WidgetPreview widget={widget} />
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2 border-t border-border/70 pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onEdit(widget)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onRemove(widget)}
                    >
                      Remove
                    </Button>
                  </div>

                  <button
                    type="button"
                    className="absolute bottom-2 right-2 size-8 cursor-nwse-resize rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-sm transition hover:bg-primary/20"
                    aria-label={`Resize ${widget.title}`}
                    onPointerDown={(event) => startResize(event, widget)}
                  >
                    ↘
                  </button>
                </CardContent>
              </Card>
            ))}
            {dropIndicator && activeWidgetId ? (
              <div
                className={cn(
                  'pointer-events-none absolute z-20 rounded-full bg-primary shadow-lg ring-4 ring-primary/20 transition-[left,top,width,height] duration-100 ease-out',
                  dropIndicator.orientation === 'vertical'
                    ? '-translate-x-1/2'
                    : '-translate-y-1/2',
                )}
                style={dropIndicator.style}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
