'use client';

import { FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { GroupId } from '@/bindings/GroupId';
import { useWebsocketState } from '@/hooks/websocket';
import { Menu } from 'react-daisyui';

import dynamicImport from 'next/dynamic';
import Link from 'next/link';
import { Device } from '@/bindings/Device';
import { getDeviceKey } from '@/lib/device';
import Color from 'color';
import { excludeUndefined } from 'utils/excludeUndefined';
const NoSSRPreview = dynamicImport(() => import('./Preview'), { ssr: false });

export default function Page() {
  const state = useWebsocketState();

  const groups: [GroupId, FlattenedGroupConfig][] = Object.entries(
    excludeUndefined(state?.groups),
  );

  const filteredGroups = groups.filter(([, group]) => !group.hidden);
  filteredGroups.sort((a, b) => a[1].name.localeCompare(b[1].name));

  const devices: Device[] = Object.values(excludeUndefined(state?.devices));

  return (
    <>
      <Menu className="flex-1 flex-nowrap overflow-y-auto">
        {filteredGroups.map(([groupId, group]) => {
          const filteredDevices = devices.filter((device) =>
            group.device_keys.includes(getDeviceKey(device)),
          );

          return (
            <Link key={groupId} href={`/groups/${groupId}`}>
              <Menu.Item>
                <div className="flex py-0">
                  <div className="flex-1 truncate">{group.name}</div>
                  <div className="h-[96px] w-[112px]">
                    <NoSSRPreview
                      devices={filteredDevices}
                      overrideColor={Color({ h: 35, s: 50, v: 100 })}
                    />
                  </div>
                </div>
              </Menu.Item>
            </Link>
          );
        })}
      </Menu>
    </>
  );
}
