import { useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { useHelpers } from '@/hooks/useConfig';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { matchesConfigSearch } from '@/lib/configSearch';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { ConfigPageHeader } from '../page-header';
import { formatValue, kindLabel } from './shared';

export default function HelpersConfigPage() {
  const api = useHelpers(),
    { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const query = params.get('q') ?? '';
  useCreateDeepLink(
    useCallback(() => navigate('/config/helpers/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'helper' });
  const visible = api.data.filter((row) =>
    matchesConfigSearch(query, row.name, row.id, kindLabel(row.kind)),
  );
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Helpers"
        description="Values that routines can read and change, such as a home mode or a counter."
        actions={
          <Button asChild>
            <Link to="/config/helpers/new">
              <Plus className="size-4" />
              Add helper
            </Link>
          </Button>
        }
      />
      <ConfigListSearchBar
        value={query}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          if (value) next.set('q', value);
          else next.delete('q');
          setParams(next, { replace: true });
        }}
        totalCount={api.data.length}
        filteredCount={visible.length}
        placeholder="Search helpers"
      />
      {api.error ? (
        <div role="alert">
          {api.error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void api.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : api.loading ? (
        <Skeleton className="h-40" />
      ) : !visible.length ? (
        <EmptyState
          title={api.data.length ? 'No matching helpers' : 'No helpers yet'}
          description="Use Add helper to create a value for your routines."
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {visible.map((row) => (
            <Link
              key={row.id}
              to={configItemHref('helper', row.id)}
              className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{row.name}</strong>
                <span className="text-xs text-muted-foreground">
                  {kindLabel(row.kind)} ·{' '}
                  {row.persistence === 'durable'
                    ? 'Keeps value on restart'
                    : 'Resets on restart'}
                  {row.hidden ? ' · Hidden' : ''}
                  {advanced ? ` · ${row.id}` : ''}
                </span>
              </div>
              <span
                className="max-w-[35%] truncate text-sm"
                title={formatValue(row.value)}
              >
                {formatValue(row.value)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
