import {
  useDevicesState,
  useScenesState,
  useWebsocket,
} from '@/hooks/websocket';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { SceneId } from '@/bindings/SceneId';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useSceneModalState } from '@/hooks/sceneModalState';
import { excludeUndefined } from 'utils/excludeUndefined';
import Preview from '../Preview';
import { cn } from '@/lib/cn';
import { Card, CardContent } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';

type Props = { deviceKeys: string[]; showAll?: boolean };
export const SceneList = (props: Props) => {
  const ws = useWebsocket();
  const liveScenes = useScenesState();
  const liveDevices = useDevicesState();

  const { setOpen: setSceneModalOpen, setState: setSceneModalState } =
    useSceneModalState();

  const scenes = excludeUndefined(liveScenes ?? undefined);

  if (!scenes) return null;

  const filteredScenes = Object.entries(scenes).filter(([, scene]) => {
    if (props.showAll) return true;

    const devices = scene.devices;
    if (
      props.deviceKeys.find((deviceKey) =>
        Object.keys(devices).includes(deviceKey),
      )
    ) {
      return true;
    } else {
      return false;
    }
  });

  filteredScenes.sort((a, b) => a[1].name.localeCompare(b[1].name));

  const devices: Device[] = Object.values(
    excludeUndefined(liveDevices ?? undefined),
  );

  const handleSceneClick = (sceneId: SceneId) => () => {
    const msg: WebSocketRequest = {
      EventMessage: {
        Action: {
          action: 'ActivateScene',
          device_keys: props.deviceKeys,
          group_keys: null,
          mirror_from_group: null,
          include_source_groups: false,
          use_scene_transition: false,
          transition: null,
          rollout: null,
          rollout_source_device_key: null,
          rollout_duration_ms: null,
          scene_id: sceneId,
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
  };

  const openSceneModal =
    (sceneId: SceneId) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setSceneModalState(sceneId);
      setSceneModalOpen(true);
    };

  return (
    <div className="flex-1 overflow-y-auto">
      {filteredScenes.length === 0 ? (
        <EmptyState
          title="No matching scenes"
          description="Scenes targeting this selection will appear here."
          className="m-3"
        />
      ) : (
        <div className="grid gap-3 p-3">
          {filteredScenes.map(([sceneId, scene]) => {
            const previewDevices = Object.entries(
              excludeUndefined(scene.devices),
            ).flatMap(([id, state]) => {
              const origDevice = devices.find(
                (device) => getDeviceKey(device) === id,
              );

              if (!origDevice) return [];
              if (!props.deviceKeys?.includes(getDeviceKey(origDevice)))
                return [];

              const device = JSON.parse(JSON.stringify(origDevice)) as Device;
              if ('Controllable' in device.data) {
                device.data.Controllable.state = state;
              }

              return [device];
            });

            const active =
              previewDevices.length !== 0 &&
              previewDevices.every((device) => {
                if ('Controllable' in device.data) {
                  return device.data.Controllable.scene_id === sceneId;
                }

                return false;
              });

            return (
              <button
                key={sceneId}
                onClick={handleSceneClick(sceneId)}
                onContextMenu={openSceneModal(sceneId)}
                className="text-left"
              >
                <Card
                  className={cn(
                    'overflow-hidden transition-colors hover:bg-accent/50',
                    active && 'border-primary bg-primary/10',
                  )}
                >
                  <CardContent className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold tracking-tight">
                        {scene.name}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {active ? 'Active' : 'Tap to activate'} · long-press or
                        right-click to edit
                      </p>
                    </div>
                    <div className="h-24 w-28 shrink-0 overflow-hidden rounded-2xl bg-muted">
                      <Preview devices={previewDevices} />
                    </div>
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
