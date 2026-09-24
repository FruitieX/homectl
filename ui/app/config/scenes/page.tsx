import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { type Scene, useScenes } from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useCreateDeepLink } from '@/hooks/useDeepLink';
import { matchesConfigSearch } from '@/lib/configSearch';
import { sceneTargetsSummary } from '@/lib/sceneTargets';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ConfigPageHeader } from '../page-header';
import {
  ResolvedColorDot,
  resolveSceneColor,
} from '@/ui/SceneResolvedColorPreview';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigToggleRow,
} from '@/ui/config-form';
import { checkboxClassName } from '@/ui/form-styles';

const getSceneSearchValues = (scene: Scene) => [
  scene.id,
  scene.name,
  scene.hidden ? 'hidden' : 'visible',
  scene.script ?? '',
  Object.keys(scene.device_states ?? {}),
  Object.keys(scene.group_states ?? {}),
];

export default function ScenesPage() {
  const { data: scenes, loading, error, refetch, create, remove } = useScenes();
  const { devicesState: devices } = useDevicesApi();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const navigate = useNavigate();
  useCreateDeepLink(
    useCallback(() => navigate('/config/scenes/new'), [navigate]),
  );
  useAssistantPageContext({ kind: 'scene' });

  // Legacy `?scene=<id>` links open the new detail route instead of expanding a
  // card in place; `?device=` becomes a target focus.
  const requestedSceneId = searchParams.get('scene');
  const requestedDeviceKey = searchParams.get('device');
  useEffect(() => {
    if (!requestedSceneId || loading) return;
    const query = requestedDeviceKey
      ? `?target=${encodeURIComponent(requestedDeviceKey)}`
      : '';
    navigate(`/config/scenes/${encodeURIComponent(requestedSceneId)}${query}`, {
      replace: true,
    });
  }, [loading, navigate, requestedDeviceKey, requestedSceneId]);

  const deviceKeys = useMemo(
    () => Object.keys(devices).filter((key) => devices[key] !== undefined),
    [devices],
  );

  const visibleScenes = scenes.filter((scene) =>
    matchesConfigSearch(search, ...getSceneSearchValues(scene)),
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-3">
          <p>Could not load scenes: {error}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Scenes"
        description="Save a state you can recall by hand or from an automation."
        actions={
          <Button asChild>
            <Link to="/config/scenes/new">Add scene</Link>
          </Button>
        }
      />

      <ConfigListSearchBar
        filteredCount={visibleScenes.length}
        onChange={setSearch}
        placeholder="Search scenes"
        totalCount={scenes.length}
        value={search}
      />

      {visibleScenes.length === 0 ? (
        <EmptyState
          title={
            scenes.length === 0
              ? 'No scenes yet'
              : 'No scenes match the current search'
          }
          description={
            scenes.length === 0
              ? 'Save a useful light or device state to recall it later.'
              : 'Try another name, id, or target.'
          }
          action={
            scenes.length === 0 ? (
              <Button size="sm" asChild>
                <Link to="/config/scenes/new">Create your first scene</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleScenes.map((scene) => {
            const summary = sceneTargetsSummary(scene, {
              deviceKeys,
              sceneIds: scenes.map((entry) => entry.id),
            });
            const resolved = [
              ...Object.entries(scene.device_states ?? {}).map(
                ([key, config]) => ({
                  key: `device:${key}`,
                  resolved: resolveSceneColor(
                    config,
                    'device',
                    key,
                    scenes,
                    devices,
                  ),
                }),
              ),
              ...Object.entries(scene.group_states ?? {}).map(
                ([key, config]) => ({
                  key: `group:${key}`,
                  resolved: resolveSceneColor(
                    config,
                    'group',
                    key,
                    scenes,
                    devices,
                  ),
                }),
              ),
            ].filter(
              (
                entry,
              ): entry is {
                key: string;
                resolved: NonNullable<typeof entry.resolved>;
              } => entry.resolved !== null,
            );

            return (
              <Card
                key={scene.id}
                className="rounded-2xl border-border/70 shadow-sm transition hover:border-primary/40 hover:bg-accent/30 hover:shadow-md"
              >
                <Link
                  to={`/config/scenes/${encodeURIComponent(scene.id)}`}
                  className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle>{scene.name}</CardTitle>
                        <CardDescription>
                          {summary.deviceCount}{' '}
                          {summary.deviceCount === 1 ? 'device' : 'devices'} ·{' '}
                          {summary.groupCount}{' '}
                          {summary.groupCount === 1 ? 'room' : 'rooms'}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {scene.hidden && <Badge variant="muted">Hidden</Badge>}
                        {summary.unresolvedCount > 0 ? (
                          <Badge variant="warning" className="font-medium">
                            {summary.unresolvedCount} unresolved
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {summary.total === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {summary.scripted
                          ? 'Script-only scene.'
                          : 'No targets — activating this would change nothing.'}
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {resolved
                          .slice(0, 8)
                          .map(({ key, resolved: colors }) => (
                            <ResolvedColorDot
                              key={key}
                              className="inline-flex h-3.5 w-3.5 rounded-full border border-foreground/15 shadow-inner"
                              color={colors.color}
                              isPowered={colors.isPowered}
                            />
                          ))}
                        {summary.scripted ? (
                          <Badge variant="secondary">Script</Badge>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </Link>
                <div className="flex justify-end px-4 pb-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={async () => {
                      if (
                        await confirmDestructive(
                          `Delete scene "${scene.name}"?`,
                          'Routines and scene links that reference this scene will stop resolving.',
                        )
                      ) {
                        await remove(scene.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
