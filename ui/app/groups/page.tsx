'use client';

import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { GroupId } from '@/bindings/GroupId';
import { useWebsocketState } from '@/hooks/websocket';
import { Card } from 'react-daisyui';

import dynamicImport from 'next/dynamic';
const NoSSRPreview = dynamicImport(() => import('./Preview'), { ssr: false });

export default function Page() {
  const state = useWebsocketState();

  const groups: [GroupId, FlattenedGroupConfig][] = Object.entries(
    state?.groups ?? {},
  );

  const filtered = groups.filter(([, group]) => !group.hidden);
  filtered.sort((a, b) => a[1].name.localeCompare(b[1].name));

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        {filtered.map(([groupId, group]) => (
          <Card key={groupId} onClick={console.log} className="card-side">
            <Card.Body>
              <Card.Title className="truncate">{group.name}</Card.Title>
            </Card.Body>
            <div>
              <NoSSRPreview deviceKeys={group.device_ids} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
