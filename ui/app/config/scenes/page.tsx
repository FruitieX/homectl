import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useScenes, useSources } from '@/hooks/useConfig';
import { useScenesState } from '@/hooks/websocket';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { sceneTargetsSummary, sourceAliasKeys } from '@/lib/sceneTargets';
import { matchesConfigSearch } from '@/lib/configSearch';
import { configItemHref } from '@/lib/configItemHref';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { StatePreview } from '@/ui/settings/StatePreview';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
import { ConfigPageHeader } from '../page-header';
export default function ScenesPage() {
  const api = useScenes();
  const sources = useSources();
  const catalog = useDevicesApi();
  const runtime = useScenesState();
  const { advanced } = useSettingsPreferences();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const navigate = useNavigate();
  useCreateDeepLink(
    useCallback(() => navigate('/config/scenes/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'scene' });
  useEffect(() => {
    const scene = params.get('scene');
    if (scene)
      navigate(
        `${configItemHref('scene', scene)}${params.get('device') ? '?section=devices&target=' + encodeURIComponent(params.get('device')!) : ''}`,
        { replace: true },
      );
  }, [params, navigate]);
  const visible = api.data.filter((scene) =>
    matchesConfigSearch(
      search,
      scene.id,
      scene.name,
      scene.hidden ? 'hidden' : 'visible',
      ...Object.keys(scene.device_states),
      ...Object.keys(scene.group_states),
    ),
  );
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Scenes"
        description="Saved states and links for your devices and groups."
        actions={
          <Button asChild>
            <Link to="/config/scenes/new">
              <Plus className="size-4" />
              Add scene
            </Link>
          </Button>
        }
      />
      <ConfigListSearchBar
        filteredCount={visible.length}
        totalCount={api.data.length}
        value={search}
        onChange={(value) => {
          setSearch(value);
          const next = new URLSearchParams(params);
          if (value) next.set('q', value);
          else next.delete('q');
          setParams(next, { replace: true });
        }}
        placeholder="Search scenes or targets"
      />
      {api.error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {api.error}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void api.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : api.loading ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : !visible.length ? (
        <EmptyState
          title={api.data.length ? 'No matching scenes' : 'No scenes yet'}
          description="Use Add scene to configure group and device states."
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {visible.map((scene) => {
            const summary = sceneTargetsSummary(scene, {
              sceneIds: api.data.map((row) => row.id),
              deviceKeys:
                !catalog.loading && !catalog.error
                  ? Object.keys(catalog.devicesState)
                  : undefined,
              aliases: sourceAliasKeys(sources.data),
            });
            const resolved = runtime?.[scene.id];
            const samples = Object.entries(resolved?.devices ?? {})
              .sort(([a], [b]) => a.localeCompare(b))
              .slice(0, 4);
            return (
              <div
                key={scene.id}
                className="flex items-center gap-2 pr-2 hover:bg-muted/40"
              >
                <Link
                  to={configItemHref('scene', scene.id)}
                  className="flex min-h-[76px] min-w-0 flex-1 items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {scene.name}
                      {scene.hidden && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          Hidden
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {summary.groupCount} groups · {summary.deviceCount} device
                      targets{summary.scripted && ' · Script'}
                      {resolved?.active_overrides.length
                        ? ` · ${resolved.active_overrides.length} saved overrides`
                        : ''}
                      {advanced && (
                        <span className="ml-2 font-mono">{scene.id}</span>
                      )}
                    </span>
                    {summary.unresolvedCount > 0 && (
                      <span className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="size-3" />
                        {summary.unresolvedCount} unresolved links
                      </span>
                    )}
                  </span>
                  <span className="hidden items-center gap-1 sm:flex">
                    {samples.map(([key, state]) => (
                      <StatePreview
                        key={key}
                        {...state}
                        brightness={
                          state.brightness ?? (state.power ? 1 : null)
                        }
                        source="Saved scene resolution"
                        size={26}
                      />
                    ))}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${scene.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() =>
                        navigate(
                          `/config/scenes/new?copyFrom=${encodeURIComponent(scene.id)}`,
                        )
                      }
                    >
                      <Copy className="size-4" />
                      Duplicate scene
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
