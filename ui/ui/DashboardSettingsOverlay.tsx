import { useState } from 'react';
import { Layers3, Plus, Trash2 } from 'lucide-react';

import {
  DASHBOARD_GRID_SNAP_OPTIONS,
  DASHBOARD_SCREEN_SIMULATION_OPTIONS,
  type DashboardGridSnap,
  type DashboardScreenSimulation,
} from '@/hooks/dashboardEditing';
import { type DashboardLayout } from '@/hooks/useDashboard';
import { ConfigField, ConfigFormSection } from '@/ui/config-form';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';

const selectClassName =
  'h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export interface DashboardSettingsOverlayProps {
  open: boolean;
  onClose: () => void;
  layouts: DashboardLayout[];
  layoutsLoading: boolean;
  layoutsError: string | null;
  activeLayout: DashboardLayout | null;
  selectedLayoutId: string | null;
  onSelectLayout: (layoutId: string) => void;
  onCreateLayout: (name: string) => Promise<DashboardLayout>;
  onDeleteLayout: (layoutId: string) => Promise<void>;
  gridSnap: DashboardGridSnap;
  screenSimulation: DashboardScreenSimulation;
  onGridSnapChange: (value: DashboardGridSnap) => void;
  onScreenSimulationChange: (value: DashboardScreenSimulation) => void;
}

export function DashboardSettingsOverlay({
  open,
  onClose,
  layouts,
  layoutsLoading,
  layoutsError,
  activeLayout,
  selectedLayoutId,
  onSelectLayout,
  onCreateLayout,
  onDeleteLayout,
  gridSnap,
  screenSimulation,
  onGridSnapChange,
  onScreenSimulationChange,
}: DashboardSettingsOverlayProps) {
  const [newLayoutName, setNewLayoutName] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const currentLayoutId = activeLayout?.id ?? selectedLayoutId ?? '';
  const simulationOption = DASHBOARD_SCREEN_SIMULATION_OPTIONS.find(
    (option) => option.value === screenSimulation,
  );

  const createLayout = async () => {
    const name = newLayoutName.trim();
    if (!name) return;

    try {
      setActionError(null);
      const layout = await onCreateLayout(name);
      onSelectLayout(layout.id);
      setNewLayoutName('');
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to create layout.',
      );
    }
  };

  const deleteLayout = async (layout: DashboardLayout) => {
    if (
      !(await confirmDestructive(
        `Delete layout "${layout.name}"?`,
        'Widgets stay available in the widget gallery; only this layout arrangement is removed.',
      ))
    ) {
      return;
    }

    try {
      setActionError(null);
      await onDeleteLayout(layout.id);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to delete layout.',
      );
    }
  };

  return (
    <>
      <ResponsiveOverlay
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
        title="Dashboard editor"
        description="Manage dashboard layouts and editor behavior without leaving the dashboard."
        presentation="fullscreen"
        className="max-w-4xl"
      >
        <div className="space-y-5 px-5 pb-5 md:px-0 md:pb-0">
          {layoutsError || actionError ? (
            <Alert variant="destructive">
              <AlertTitle>Dashboard editor action failed</AlertTitle>
              <AlertDescription>{actionError ?? layoutsError}</AlertDescription>
            </Alert>
          ) : null}

          <ConfigFormSection
            title="Layouts"
            description="Switch between dashboard compositions or create a separate layout for another display."
            actions={
              <Badge variant="secondary">
                {layouts.length} {layouts.length === 1 ? 'layout' : 'layouts'}
              </Badge>
            }
          >
            {layoutsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {layouts.map((layout) => {
                    const selected = currentLayoutId === layout.id;
                    return (
                      <div
                        key={layout.id}
                        className={`flex items-center gap-2 rounded-2xl border p-2 transition ${selected ? 'border-primary bg-primary/10' : 'border-border bg-muted/20'}`}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left hover:bg-accent hover:text-accent-foreground"
                          onClick={() => onSelectLayout(layout.id)}
                        >
                          <Layers3 className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {layout.name}
                          </span>
                          {layout.is_default ? (
                            <Badge variant="secondary">Default</Badge>
                          ) : null}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-destructive hover:text-destructive"
                          aria-label={`Delete ${layout.name}`}
                          onClick={() => void deleteLayout(layout)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    );
                  })}
                  {layouts.length === 0 ? (
                    <EmptyState
                      title="No layouts yet"
                      description="Create a layout before adding widgets."
                    />
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={newLayoutName}
                    placeholder="New layout name"
                    aria-label="New layout name"
                    onChange={(event) => setNewLayoutName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void createLayout();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={!newLayoutName.trim()}
                    onClick={() => void createLayout()}
                  >
                    <Plus />
                    Add layout
                  </Button>
                </div>
              </>
            )}
          </ConfigFormSection>

          <ConfigFormSection
            title="Editor behavior"
            description="These preferences are stored on this device. Device size is the default so opening edit mode does not rearrange the dashboard."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <ConfigField
                label="Resize snap"
                description="Choose the smallest unit used by the resize handle."
              >
                <select
                  className={selectClassName}
                  value={gridSnap}
                  onChange={(event) =>
                    onGridSnapChange(
                      Number(event.target.value) as DashboardGridSnap,
                    )
                  }
                >
                  {DASHBOARD_GRID_SNAP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </ConfigField>
              <ConfigField
                label="Screen-size simulation"
                description={simulationOption?.description}
              >
                <select
                  className={selectClassName}
                  value={screenSimulation}
                  onChange={(event) =>
                    onScreenSimulationChange(
                      event.target.value as DashboardScreenSimulation,
                    )
                  }
                >
                  {DASHBOARD_SCREEN_SIMULATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </ConfigField>
            </div>
          </ConfigFormSection>
        </div>
      </ResponsiveOverlay>
    </>
  );
}
