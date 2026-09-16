import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';

import { type DashboardWidget } from '@/hooks/useDashboard';
import {
  getDashboardColumnsForScreen,
  type DashboardGridSnap,
  type DashboardScreenSimulation,
} from '@/hooks/dashboardEditing';
import { cn } from '@/lib/cn';
import {
  DASHBOARD_GRID_PRECISION,
  DASHBOARD_MIN_SIZE_UNIT,
  clampDashboardWidgetHeight,
  clampDashboardWidgetWidth,
  getDashboardWidgetGridStyle,
  getDashboardWidgetResponsiveGridStyle,
  DASHBOARD_COMPACT_COLUMNS,
  DASHBOARD_MOBILE_COLUMNS,
  DASHBOARD_WIDE_COLUMNS,
} from '@/lib/dashboard-layout';
import { Button } from '@/ui/primitives/button';
import { DashboardWidgetCard } from '@/ui/DashboardWidgetCard';
import { Pencil, Trash2 } from 'lucide-react';

const GRID_ROW_HEIGHT_PX = 160;
const GRID_GAP_PX = 12;
const DRAG_THRESHOLD_PX = 6;

type PreviewColumnCount =
  | typeof DASHBOARD_MOBILE_COLUMNS
  | typeof DASHBOARD_COMPACT_COLUMNS
  | typeof DASHBOARD_WIDE_COLUMNS;

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
      gridSnap: DashboardGridSnap;
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
  variant?: 'settings' | 'inline';
  dashboardScrollEnabled?: boolean;
  gridSnap?: DashboardGridSnap;
  screenSimulation?: DashboardScreenSimulation;
}

interface DropIndicator {
  insertionIndex: number;
  orientation: 'horizontal' | 'vertical';
  style: CSSProperties;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const renderedColumns = columns * DASHBOARD_GRID_PRECISION;
  const cellWidth = Math.max(
    1,
    (contentWidth - columnGap * (renderedColumns - 1)) / renderedColumns,
  );

  return {
    columns,
    cellWidth,
    cellHeight: GRID_ROW_HEIGHT_PX / DASHBOARD_GRID_PRECISION,
    columnGap,
    rowGap,
  };
}

function getAutoLayoutStyle(
  widget: DashboardWidget,
  columns: PreviewColumnCount,
  useResponsiveLayout: boolean,
) {
  const width = clampDashboardWidgetWidth(widget.width, columns);
  const height = clampDashboardWidgetHeight(widget.height);

  return useResponsiveLayout
    ? getDashboardWidgetResponsiveGridStyle(widget.width, height)
    : getDashboardWidgetGridStyle(width, height);
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
  return <DashboardWidgetCard widget={widget} />;
}

export function DashboardGridEditor({
  widgets,
  onEdit,
  onRemove,
  onUpdateWidget,
  onReorderWidgets,
  variant = 'settings',
  dashboardScrollEnabled = true,
  gridSnap = 0.25,
  screenSimulation = 'device',
}: DashboardGridEditorProps) {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  );
  const previewColumns = getDashboardColumnsForScreen(
    screenSimulation,
    viewportWidth,
  ) as PreviewColumnCount;
  const [draftWidgets, setDraftWidgets] = useState(() => sortWidgets(widgets));
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [activeInteractionKind, setActiveInteractionKind] = useState<
    GridInteraction['kind'] | null
  >(null);
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
    if (screenSimulation !== 'device') {
      return;
    }

    const updateForViewport = () => setViewportWidth(window.innerWidth);
    updateForViewport();
    window.addEventListener('resize', updateForViewport);
    return () => window.removeEventListener('resize', updateForViewport);
  }, [screenSimulation]);

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

      const widthDelta =
        deltaX /
        (interaction.cellWidth + interaction.columnGap) /
        DASHBOARD_GRID_PRECISION;
      const heightDelta =
        deltaY /
        (interaction.cellHeight + interaction.rowGap) /
        DASHBOARD_GRID_PRECISION;
      const nextWidth = clampDashboardWidgetWidth(
        Math.round(
          (interaction.startWidth + widthDelta) / interaction.gridSnap,
        ) * interaction.gridSnap,
        interaction.columns,
      );
      const nextHeight = clampDashboardWidgetHeight(
        Math.round(
          (interaction.startHeight + heightDelta) / interaction.gridSnap,
        ) * interaction.gridSnap,
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
      setActiveInteractionKind(null);
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
    setActiveInteractionKind('drag');
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
    event.currentTarget.setPointerCapture(event.pointerId);
    const metrics = getGridMetrics(gridRef.current, previewColumns);

    setDropIndicator(null);
    interactionRef.current = {
      id: widget.id,
      kind: 'resize',
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: clampDashboardWidgetWidth(
        Math.max(widget.width, DASHBOARD_MIN_SIZE_UNIT),
        previewColumns,
      ),
      startHeight: clampDashboardWidgetHeight(widget.height),
      gridSnap,
      ...metrics,
    };
    setActiveWidgetId(widget.id);
    setActiveInteractionKind('resize');
  };

  const isInline = variant === 'inline';
  const usesDeviceLayout = isInline && screenSimulation === 'device';

  return (
    <div
      className={cn('space-y-3', isInline && 'flex min-h-0 flex-1 flex-col')}
    >
      {editorError ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {editorError}
        </div>
      ) : null}
      <div
        className={cn(
          !isInline && 'rounded-3xl bg-muted/20 p-3',
          isInline && 'min-h-0 flex-1',
        )}
      >
        <div
          className={cn(
            !isInline && 'overflow-x-auto pb-2',
            isInline && 'min-h-0 h-full',
          )}
        >
          <div
            ref={gridRef}
            className={cn(
              'relative grid min-w-0 grid-flow-row gap-0',
              isInline && 'dashboard-layout-grid',
              isInline && dashboardScrollEnabled
                ? 'auto-rows-[minmax(calc(var(--dashboard-row)/4),auto)]'
                : isInline && 'h-full min-h-0 flex-1 overflow-hidden',
            )}
            style={{
              gridTemplateColumns: usesDeviceLayout
                ? undefined
                : `repeat(${previewColumns * DASHBOARD_GRID_PRECISION}, minmax(0, 1fr))`,
              gridAutoRows:
                isInline && dashboardScrollEnabled
                  ? 'minmax(calc(var(--dashboard-row) / 4), auto)'
                  : isInline
                    ? 'minmax(0, 1fr)'
                    : `${GRID_ROW_HEIGHT_PX / DASHBOARD_GRID_PRECISION}px`,
              minWidth: isInline ? undefined : `${previewColumns * 6}rem`,
            }}
          >
            {draftWidgets.map((widget) => (
              <div
                key={widget.id}
                ref={(element) => {
                  if (element) {
                    cardRefs.current.set(widget.id, element);
                  } else {
                    cardRefs.current.delete(widget.id);
                  }
                }}
                className={cn(
                  'dashboard-layout-item relative min-h-0 min-w-0 *:h-full',
                  activeWidgetId === widget.id && 'z-10 cursor-grabbing',
                  savingWidgetId === widget.id && 'opacity-70',
                )}
                style={{
                  ...getAutoLayoutStyle(
                    widget,
                    previewColumns,
                    usesDeviceLayout,
                  ),
                  margin: isInline
                    ? 'calc(var(--dashboard-gap) / 2)'
                    : `${GRID_GAP_PX / 2}px`,
                }}
                onPointerDown={(event) => startDrag(event, widget)}
              >
                <div className="pointer-events-none h-full min-h-0">
                  <WidgetPreview widget={widget} />
                </div>
                <div className="absolute right-2 top-2 z-30 flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="pointer-events-auto size-8 rounded-xl border border-border/70 bg-background/85 shadow-sm backdrop-blur hover:bg-background"
                    aria-label={`Edit ${widget.title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onEdit(widget)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="pointer-events-auto size-8 rounded-xl border border-border/70 bg-background/85 text-destructive shadow-sm backdrop-blur hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove ${widget.title}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onRemove(widget)}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <button
                  type="button"
                  className="pointer-events-auto absolute bottom-2 right-2 z-30 size-10 touch-none select-none cursor-nwse-resize rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-sm transition hover:bg-primary/20"
                  aria-label={`Resize ${widget.title}`}
                  onPointerDown={(event) => startResize(event, widget)}
                >
                  <span aria-hidden="true">↘</span>
                </button>
                {activeWidgetId === widget.id &&
                activeInteractionKind === 'resize' ? (
                  <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
                    <div
                      className="rounded-2xl border border-primary/40 bg-background/90 px-4 py-3 text-center text-sm font-semibold tabular-nums text-foreground shadow-xl backdrop-blur"
                      aria-live="polite"
                    >
                      {widget.width} × {widget.height}
                    </div>
                  </div>
                ) : null}
              </div>
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
