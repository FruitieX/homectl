import { use } from 'react';

import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { SceneList } from './SceneList';
import { useGroupsState } from '@/hooks/websocket';

type Props = {
  params: Promise<{ id: string }>;
};

export default function Page(props: Props) {
  const params = use(props.params);
  const groups = useGroupsState();

  const group: FlattenedGroupConfig | undefined = groups?.[params.id];
  const groupDevices = group?.device_keys;

  if (!groupDevices) return null;

  return <SceneList deviceKeys={groupDevices} />;
}
