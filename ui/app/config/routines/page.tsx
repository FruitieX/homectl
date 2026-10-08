import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Copy, MoreHorizontal, Plus } from 'lucide-react';
import { useRoutines } from '@/hooks/useConfig';
import { useRoutineStatuses } from '@/hooks/websocket';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { matchesConfigSearch } from '@/lib/configSearch';
import { configItemHref } from '@/lib/configItemHref';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { Button } from '@/ui/primitives/button';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
import { ConfigPageHeader } from '../page-header';
export default function RoutinesPage() {
  const api = useRoutines(),
    statuses = useRoutineStatuses();
  const { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '',
    filter = params.get('filter') ?? 'all';
  const [limit, setLimit] = useState(50);
  const navigate = useNavigate();
  useCreateDeepLink(
    useCallback(() => navigate('/config/routines/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'routine' });
  useEffect(() => {
    const id = params.get('routine');
    if (id) navigate(configItemHref('routine', id), { replace: true });
  }, [params, navigate]);
  const visible = api.data.filter(
    (row) =>
      matchesConfigSearch(
        search,
        row.id,
        row.name,
        JSON.stringify(row.definition_v2 ?? row.rules),
      ) &&
      (filter === 'all' ||
        (filter === 'enabled'
          ? row.enabled
          : filter === 'disabled'
            ? !row.enabled
            : (row.semantics_version ?? 1) === 1)),
  );
  function changeParam(key: string, value: string) {
    setLimit(50);
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Routines"
        description="What starts your automations and what they do."
        actions={
          <Button asChild>
            <Link to="/config/routines/new">
              <Plus className="size-4" />
              Add routine
            </Link>
          </Button>
        }
      />
      <ConfigListSearchBar
        value={search}
        filteredCount={visible.length}
        totalCount={api.data.length}
        onChange={(value) => changeParam('q', value)}
        placeholder="Search routines"
      >
        <SettingsSelect
          aria-label="Filter routines"
          className="w-full sm:w-44"
          value={filter}
          onValueChange={(value) => changeParam('filter', value)}
          options={[
            { value: 'all', label: 'All routines' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'disabled', label: 'Disabled' },
            { value: 'legacy', label: 'Legacy' },
          ]}
        />
      </ConfigListSearchBar>
      {api.error ? (
        <div role="alert" className="text-sm text-destructive">
          {api.error}
          <Button variant="outline" onClick={() => void api.refetch()}>
            Retry
          </Button>
        </div>
      ) : api.loading ? (
        <p className="text-sm text-muted-foreground">Loading routines…</p>
      ) : !visible.length ? (
        <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          {search
            ? 'No routines match your search.'
            : 'No routines in this view yet.'}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {visible.slice(0, limit).map((row) => {
            const version = row.semantics_version ?? 1,
              triggers = row.definition_v2?.triggers ?? [],
              status = statuses?.[row.id]?.v2;
            const error = status?.condition?.error;
            return (
              <div
                className="flex min-w-0 items-center gap-3 px-4 py-3"
                key={row.id}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${row.enabled ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                  aria-label={row.enabled ? 'Enabled' : 'Disabled'}
                />
                <Link
                  className="min-w-0 flex-1"
                  to={configItemHref('routine', row.id)}
                >
                  <p className="truncate text-sm font-medium hover:underline">
                    {row.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {row.enabled ? 'Enabled' : 'Disabled'} ·{' '}
                    {version === 2
                      ? `${triggers.length} ${triggers.length === 1 ? 'start' : 'starts'}${triggers.length ? ' · ' + triggers.map((trigger) => trigger.kind.replaceAll('_', ' ')).join(', ') : ''}`
                      : version === 1
                        ? `${row.rules.length} legacy rules`
                        : `Unsupported version ${version}`}
                  </p>
                  {error && (
                    <p className="mt-1 text-xs text-destructive">{error}</p>
                  )}
                  {advanced && (
                    <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                      {row.id}
                    </p>
                  )}
                </Link>
                {version === 2 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${row.name}`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          navigate(
                            `/config/routines/new?copyFrom=${encodeURIComponent(row.id)}`,
                          )
                        }
                      >
                        <Copy className="size-4" />
                        Duplicate routine
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <ChevronRight className="size-4 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      )}
      {visible.length > limit && (
        <Button
          variant="outline"
          onClick={() => setLimit((value) => value + 50)}
        >
          Show more ({visible.length - limit} remaining)
        </Button>
      )}
    </div>
  );
}
