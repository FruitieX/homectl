import { Link } from 'react-router-dom';
import { Plus, ChevronRight } from 'lucide-react';
import { ConfigPageHeader } from '../page-header';
import { ConfigSectionTabs } from '@/ui/ConfigTabs';
import { Button } from '@/ui/primitives/button';
import { useDashboardConfig } from './shared';
export default function DashboardSettingsPage() {
  const { layouts } = useDashboardConfig();
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title="Dashboards"
        description="Each display shows one dashboard; the default opens on Home."
        actions={
          <Button asChild>
            <Link to="/config/dashboard/new">
              <Plus className="size-4" />
              Add dashboard
            </Link>
          </Button>
        }
      />
      <ConfigSectionTabs />
      {layouts.isError ? (
        <p role="alert">
          Could not load dashboards.{' '}
          <Button variant="outline" onClick={() => void layouts.refetch()}>
            Retry
          </Button>
        </p>
      ) : layouts.isPending ? (
        <p>Loading dashboards…</p>
      ) : (
        <div className="divide-y rounded-lg border border-border">
          {!layouts.data.length && (
            <p className="p-4 text-sm text-muted-foreground">
              No dashboards yet. Add one to start arranging widgets.
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
    </div>
  );
}
