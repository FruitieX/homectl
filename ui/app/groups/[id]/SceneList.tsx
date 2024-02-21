'use client';

import { Menu } from 'react-daisyui';

import { useWebsocket, useWebsocketState } from '@/hooks/websocket';
import dynamicImport from 'next/dynamic';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { SceneId } from '@/bindings/SceneId';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useSceneModalState } from '@/hooks/sceneModalState';
const NoSSRPreview = dynamicImport(() => import('../Preview'), { ssr: false });

type Props = { deviceKeys: string[] };
export const SceneList = (props: Props) => {
  const ws = useWebsocket();
  const state = useWebsocketState();

  const { setOpen: setSceneModalOpen, setState: setSceneModalState } =
    useSceneModalState();

  const scenes = state?.scenes;

  if (!scenes) return null;

  const filteredScenes = Object.entries(scenes).filter(([, scene]) => {
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

  const devices: Device[] = Object.values(state?.devices ?? {});

  const handleSceneClick = (sceneId: SceneId) => () => {
    const msg: WebSocketRequest = {
      EventMessage: {
        Action: {
          action: 'ActivateScene',
          device_keys: props.deviceKeys,
          group_keys: null,
          scene_id: sceneId,
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
  };

  const openSceneModal =
    (sceneId: SceneId) => (e: React.MouseEvent<HTMLLIElement>) => {
      e.preventDefault();
      setSceneModalState(sceneId);
      setSceneModalOpen(true);
    };

  return (
    <>
      <Menu className="flex-1 flex-nowrap overflow-y-auto">
        {filteredScenes.map(([sceneId, scene]) => {
          const previewDevices = Object.entries(scene.devices).flatMap(
            ([id, state]) => {
              const origDevice = devices.find(
                (device) => getDeviceKey(device) === id,
              );

              if (!origDevice) return [];
              if (!props.deviceKeys?.includes(getDeviceKey(origDevice)))
                return [];

              const device = JSON.parse(JSON.stringify(origDevice));
              if ('Controllable' in device.data) {
                device.data.Controllable.state = state;
              }

              return [device];
            },
          );

          return (
            <Menu.Item
              key={sceneId}
              onClick={handleSceneClick(sceneId)}
              onContextMenu={openSceneModal(sceneId)}
            >
              <div className="flex py-0">
                <div className="flex-1 truncate">{scene.name}</div>
                <div className="h-[96px] w-[112px]">
                  <NoSSRPreview devices={previewDevices} />
                </div>
              </div>
            </Menu.Item>
          );
        })}
      </Menu>
    </>
  );
};
