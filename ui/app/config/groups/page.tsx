import { useCallback, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react';
import { useGroups } from '@/hooks/useConfig';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { missingGroupDevices, inheritedGroupDevices } from '@/lib/groupGraph';
import { matchesConfigSearch } from '@/lib/configSearch';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { Button } from '@/ui/primitives/button';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { StatePreview } from '@/ui/settings/StatePreview';
import { useDeviceLookups } from './shared';
import { ConfigPageHeader } from '../page-header';

export default function GroupsPage() {
  const { data: groups, loading, error, refetch } = useGroups();
  const lookups = useDeviceLookups();
  const { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const navigate = useNavigate();
  useCreateDeepLink(
    useCallback(() => navigate('/config/groups/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'group' });
  const visible = groups.filter((group) =>
    matchesConfigSearch(
      search,
      group.name,
      group.id,
      ...group.linked_groups,
      ...group.devices.map(lookups.labelFor),
    ),
  );
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Rooms & groups"
        description="Organize devices and include other groups."
        actions={
          <Button asChild>
            <Link to="/config/groups/new">
              <Plus className="size-4" />
              Add room or group
            </Link>
          </Button>
        }
      />
      <ConfigListSearchBar
        filteredCount={visible.length}
        totalCount={groups.length}
        value={search}
        onChange={(value) => {
          setSearch(value);
          const next = new URLSearchParams(params);
          if (value) next.set('q', value);
          else next.delete('q');
          setParams(next, { replace: true });
        }}
        placeholder="Search rooms, groups, or devices"
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load rooms & groups: {error}
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : !visible.length ? (
        <EmptyState
          title={
            groups.length
              ? 'No matching rooms or groups'
              : 'No rooms or groups yet'
          }
          description={
            groups.length
              ? 'Try another name or device.'
              : 'Use Add room or group to organize devices together.'
          }
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {visible.map((group) => {
            const inherited = inheritedGroupDevices(group, groups);
            const keys = [
              ...group.devices.map(
                (device) => `${device.integration_id}/${device.device_id}`,
              ),
              ...inherited.map((member) => member.key),
            ];
            const missing =
              !lookups.loading && !lookups.error
                ? missingGroupDevices(group, lookups.presentKeys)
                : [];
            const missingGroups = group.linked_groups.filter(
              (id) => !groups.some((row) => row.id === id),
            );
            const previewStates = keys
              .map((key) => lookups.devicesByKey[key]?.data)
              .flatMap((data) =>
                data && 'Controllable' in data ? [data.Controllable.state] : [],
              )
              .slice(0, 4);
            return (
              <Link
                key={group.id}
                to={`/config/groups/${encodeURIComponent(group.id)}`}
                className="flex min-h-[76px] items-center gap-3 px-4 py-3 hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {group.name}
                    {group.hidden && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        Hidden
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {keys.length} devices
                    {inherited.length > 0 && ` · ${inherited.length} inherited`}
                    {group.linked_groups.length > 0 &&
                      ` · ${group.linked_groups.length} linked groups`}
                    {advanced && (
                      <span className="ml-2 font-mono">{group.id}</span>
                    )}
                  </span>
                  {missing.length + missingGroups.length > 0 && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="size-3" />
                      {missing.length + missingGroups.length} missing references
                    </span>
                  )}
                </span>
                <span className="hidden items-center gap-1 sm:flex">
                  {previewStates.map((state, index) => (
                    <StatePreview
                      key={index}
                      {...state}
                      source="Requested"
                      size={26}
                    />
                  ))}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
