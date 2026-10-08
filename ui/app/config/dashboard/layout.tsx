import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useEntityDraft, entityFieldProps } from '@/hooks/useEntityDraft';
import { entityDraftStore } from '@/lib/entityDraft';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
import { ConfigPageHeader } from '../page-header';
import { EditorPreferences } from './EditorPreferences';
import {
  useDashboardConfig,
  widgetTitle,
  type DashboardLayoutRow,
} from './shared';
export default function DashboardLayoutEditor() {
  const { layoutId = 'new' } = useParams(),
    creating = layoutId === 'new',
    api = useDashboardConfig(layoutId),
    navigate = useNavigate();
  const [error, setError] = useState('');
  const initial = useMemo<DashboardLayoutRow>(
    () => ({ id: 0, name: '', is_default: false }),
    [],
  );
  const draft = useEntityDraft({
    key: `${api.endpoint}/layouts/${layoutId}`,
    item: creating
      ? initial
      : api.layouts.data?.find((row) => String(row.id) === layoutId),
    label: creating
      ? 'New dashboard'
      : (api.layouts.data?.find((row) => String(row.id) === layoutId)?.name ??
        'Dashboard'),
    href: `/config/dashboard/${layoutId}`,
    validate: (value) =>
      value.name.trim()
        ? []
        : [{ field: 'name', message: 'Enter a dashboard name.' }],
    save: async (value, expected) => {
      const saved = await api.write<DashboardLayoutRow>('/layouts', {
        ...value,
        expected: creating ? undefined : expected.revision_token,
      });
      if (creating) {
        entityDraftStore.forget(draft.key);
        navigate(`/config/dashboard/${saved.id}`, { replace: true });
      }
      return saved;
    },
  });
  const value = draft.value;
  const removeLayout = async () => {
    if (
      !value ||
      !(await confirmDialog({
        title: `Delete ${value.name}?`,
        description:
          'This deletes the dashboard and all of its widgets. Pending edits to this dashboard will also be discarded.',
        confirmLabel: 'Delete dashboard',
        destructive: true,
      }))
    )
      return;
    try {
      await api.write(`/layouts/${layoutId}`, undefined, 'DELETE');
      draft.forget();
      navigate('/config/dashboard');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not delete dashboard.',
      );
    }
  };
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title={creating ? 'New dashboard' : value?.name || 'Dashboard'}
        actions={
          !creating && (
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link to={`/?edit=1&layout=${layoutId}`}>
                  Arrange on dashboard
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="More dashboard actions"
                    title="More dashboard actions"
                  >
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    disabled={!value}
                    onSelect={() => void removeLayout()}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete dashboard
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {api.layouts.isError && (
        <p role="alert">
          Could not refresh layouts.{' '}
          <Button variant="outline" onClick={() => void api.layouts.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {!value ? (
        <p>
          {api.layouts.isPending
            ? 'Loading layout…'
            : 'This dashboard is unavailable.'}
        </p>
      ) : (
        <>
          <SettingsSection title="Details">
            <label className="block space-y-2 text-sm">
              Name
              <Input
                {...entityFieldProps(draft, 'name')}
                value={value.name}
                onChange={(event) => draft.patch({ name: event.target.value })}
              />
            </label>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={value.is_default}
                onChange={(event) =>
                  draft.patch({ is_default: event.target.checked })
                }
              />
              Use as the default dashboard
            </label>
            <p className="text-xs text-muted-foreground">
              Setting a default replaces the previous default. Displays can
              still open a specific dashboard.
            </p>
          </SettingsSection>
          {!creating && (
            <SettingsSection
              title="Widgets"
              actions={
                <Button asChild>
                  <Link to={`/config/dashboard/${layoutId}/widgets/new`}>
                    <Plus className="size-4" />
                    Add widget
                  </Link>
                </Button>
              }
            >
              {api.widgets.isError ? (
                <p role="alert">
                  Could not load widgets.{' '}
                  <Button
                    variant="outline"
                    onClick={() => void api.widgets.refetch()}
                  >
                    Retry
                  </Button>
                </p>
              ) : api.widgets.isPending ? (
                <p>Loading widgets…</p>
              ) : (
                <div className="divide-y">
                  {!api.widgets.data.length && (
                    <p className="text-sm text-muted-foreground">
                      This dashboard has no widgets yet.
                    </p>
                  )}
                  {api.widgets.data.map((widget) => (
                    <Link
                      key={widget.id}
                      className="flex items-center justify-between gap-3 py-3 hover:text-primary"
                      to={`/config/dashboard/${layoutId}/widgets/${widget.id}`}
                    >
                      <span className="min-w-0 break-words font-medium">
                        {widgetTitle(widget)}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {widget.grid_w} × {widget.grid_h}
                        <ChevronRight className="size-4" aria-hidden />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </SettingsSection>
          )}
          {!creating && (
            <EditorPreferences href={`/config/dashboard/${layoutId}`} />
          )}
          <EntitySaveBar
            draft={draft}
            createLabel={creating ? 'Create dashboard' : undefined}
          />
        </>
      )}
    </div>
  );
}
