'use client';

import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { SceneList } from './SceneList';
import { useWebsocketState } from '@/hooks/websocket';

type Props = {
  params: { id: string };
};

export default function Page(props: Props) {
  const state = useWebsocketState();

  const group: FlattenedGroupConfig | undefined =
    state?.groups[props.params.id];
  const groupDevices = group?.device_keys;

  if (!groupDevices) return null;

  return <SceneList deviceKeys={groupDevices} />;
}
