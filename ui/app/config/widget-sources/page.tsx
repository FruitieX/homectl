import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ConfigPageHeader } from '../page-header';
import { Button } from '@/ui/primitives/button';
import { sourceDefinitions, useWidgetSources } from './shared';

export default function WidgetSourcesPage() {
  const query = useWidgetSources();
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title="Widget sources"
        description="Shared data services for your dashboards. Choose what each widget displays in its own settings."
      />
      {query.isError ? (
        <div role="alert">
          Could not load widget sources.{' '}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : query.isPending ? (
        <p>Loading widget sources…</p>
      ) : (
        <div className="divide-y rounded-lg border border-border">
          {query.data?.map((source) => {
            const definition = sourceDefinitions[source.key];
            const configured =
              Object.values(source.config).some(Boolean) ||
              Object.values(source.credentials).some(Boolean);
            return (
              <Link
                key={source.key}
                to={`/config/widget-sources/${encodeURIComponent(source.key)}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium">
                    {definition?.name ?? source.key}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {definition?.description}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {source.invalidStoredConfig
                    ? 'Needs repair'
                    : configured
                      ? 'Configured'
                      : 'Not configured'}
                </span>
                <ChevronRight className="size-4 shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-4 text-sm">
        <Link className="settings-link" to="/config/sensors">
          Sensor names & groups
        </Link>
        <Link className="settings-link" to="/dashboard">
          Open dashboard
        </Link>
      </div>
    </div>
  );
}
