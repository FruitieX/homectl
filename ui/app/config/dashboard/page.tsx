import { Link } from 'react-router-dom';
import { Plus, ChevronRight } from 'lucide-react';
import { ConfigPageHeader } from '../page-header';
import { Button } from '@/ui/primitives/button';
import { useDashboardConfig } from './shared';
export default function DashboardSettingsPage() {
  const { layouts } = useDashboardConfig();
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title="Dashboards"
        description="Layouts and widgets for each display."
        actions={
          <Button asChild>
            <Link to="/config/dashboard/new">
              <Plus className="size-4" />
              Add layout
            </Link>
          </Button>
        }
      />
      {layouts.isError ? (
        <p role="alert">
          Could not load layouts.{' '}
          <Button variant="outline" onClick={() => void layouts.refetch()}>
            Retry
          </Button>
        </p>
      ) : layouts.isPending ? (
        <p>Loading layouts…</p>
      ) : (
        <div className="divide-y rounded-lg border border-border">
          {!layouts.data.length && (
            <p className="p-4 text-sm text-muted-foreground">
              No layouts yet. Add one to start arranging widgets.
            </p>
          )}
          {layouts.data.map((layout) => (
            <Link
              key={layout.id}
              to={`/config/dashboard/${layout.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1 break-words font-medium">
                {layout.name}
              </span>
              {layout.is_default && (
                <span className="text-xs text-muted-foreground">Default</span>
              )}
              <ChevronRight className="size-4 shrink-0" />
            </Link>
          ))}
        </div>
      )}
      <Link className="settings-link text-sm" to="/config/widget-sources">
        Shared widget data sources
      </Link>
    </div>
  );
}
