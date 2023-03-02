'use client';

import { Card } from 'react-daisyui';

import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { useWebsocket, useWebsocketState } from '@/hooks/websocket';
import dynamicImport from 'next/dynamic';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import { DeviceState } from '@/bindings/DeviceState';
import { SceneId } from '@/bindings/SceneId';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
const NoSSRPreview = dynamicImport(() => import('../Preview'), { ssr: false });

type Props = {
  params: { id: string };
};

export default function Page(props: Props) {
  const ws = useWebsocket();
  const state = useWebsocketState();

  const group: FlattenedGroupConfig | undefined =
    state?.groups[props.params.id];

  const groupDevices = group?.device_ids;

  const scenes = state?.scenes;

  if (!scenes || !groupDevices) return null;

  const filteredScenes = Object.entries(scenes).filter(([, scene]) => {
    const devices = scene.devices as Record<string, DeviceState>;
    if (groupDevices.find((gd) => Object.keys(devices).includes(gd))) {
      return true;
    } else {
      return false;
    }
  });

  filteredScenes.sort((a, b) => a[1].name.localeCompare(b[1].name));

  const devices: Device[] = Object.values(state?.devices ?? {});

  const handleSceneClick = (sceneId: SceneId) => () => {
    const msg: WebSocketRequest = {
      Message: {
        Action: {
          action: 'ActivateScene',
          device_keys: groupDevices as any,
          group_keys: null,
          scene_id: sceneId,
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {filteredScenes.map(([sceneId, scene]) => {
          const previewDevices = Object.entries(
            scene.devices as Record<string, DeviceState>,
          ).flatMap(([id, state]) => {
            const origDevice = devices.find(
              (device) => getDeviceKey(device) === id,
            );

            if (!origDevice) return [];
            if (!groupDevices?.includes(getDeviceKey(origDevice))) return [];

            const device: Device = {
              ...origDevice,
              state: state,
            };

            return [device];
          });

          return (
            <Card
              key={sceneId}
              onClick={handleSceneClick(sceneId)}
              onContextMenu={console.log}
              className="card-side"
            >
              <Card.Body>
                <Card.Title className="truncate">{scene.name}</Card.Title>
              </Card.Body>
              <div>
                <NoSSRPreview devices={previewDevices} />
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
