import { type Device } from '@/bindings/Device';
import { type FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import { type GroupId } from '@/bindings/GroupId';
import {
  useConnectionStatus,
  useDevicesState,
  useGroupsState,
} from '@/hooks/websocket';
import { getColor, getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { EmptyState } from '@/ui/primitives/empty-state';
import { ArrowUpRight, LampDesk, Layers3, Radio, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { excludeUndefined } from 'utils/excludeUndefined';

import Preview from './Preview';

function isControllable(device: Device) {
  return 'Controllable' in device.data;
}

export default function Page() {
  const liveGroups = useGroupsState();
  const liveDevices = useDevicesState();
  const connectionStatus = useConnectionStatus();

  const groups: [GroupId, FlattenedGroupConfig][] = Object.entries(
    excludeUndefined(liveGroups ?? undefined),
  );
  const filteredGroups = groups
    .filter(([, group]) => !group.hidden)
    .sort((left, right) => left[1].name.localeCompare(right[1].name));
  const devices: Device[] = Object.values(
    excludeUndefined(liveDevices ?? undefined),
  );
  const activeDevices = devices.filter(
    (device) => isControllable(device) && getPower(device.data),
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:px-5 lg:px-8 lg:py-6">
      <div className="mx-auto max-w-[100rem] space-y-7">
        <section className="relative overflow-hidden rounded-[2rem] border border-border/45 bg-card/72 p-5 shadow-[0_24px_80px_rgba(18,31,25,0.07)] sm:p-7">
          <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-primary">
                {connectionStatus === 'connected' ? (
                  <Radio className="size-3.5" />
                ) : (
                  <WifiOff className="size-3.5 text-amber-500" />
                )}
                Live spaces
              </div>
              <h1 className="mt-3 text-[clamp(2.25rem,6vw,4.5rem)] font-semibold leading-none tracking-[-0.07em]">
                Your rooms.
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
                Every space at a glance, with its current light and device
                state—not just a list of names.
              </p>
            </div>
            <div className="flex gap-2.5">
              <SummaryMetric
                icon={Layers3}
                value={filteredGroups.length}
                label="spaces"
              />
              <SummaryMetric
                icon={LampDesk}
                value={activeDevices.length}
                label="active"
              />
            </div>
          </div>
        </section>

        {filteredGroups.length === 0 ? (
          <EmptyState
            title="No visible rooms"
            description="Visible groups become rich room surfaces here. Create one in Studio → Groups."
          />
        ) : (
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredGroups.map(([groupId, group]) => {
              const groupDeviceKeys = new Set(group.device_keys);
              const roomDevices = devices.filter((device) =>
                groupDeviceKeys.has(getDeviceKey(device)),
              );
              const controllable = roomDevices.filter(isControllable);
              const powered = controllable.filter((device) =>
                getPower(device.data),
              );
              const sensorCount = roomDevices.length - controllable.length;
              const activeColor = powered[0]
                ? getColor(powered[0].data).hex()
                : '#5e9e7d';

              return (
                <Link
                  key={groupId}
                  to={`/groups/${groupId}`}
                  className="group relative min-h-64 overflow-hidden rounded-[2rem] border border-border/45 bg-card/72 p-4 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_24px_70px_rgba(18,31,25,0.13)]"
                >
                  <div
                    className="absolute inset-0 opacity-75 transition duration-500 group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(circle at 78% 18%, ${activeColor}38, transparent 48%)`,
                    }}
                  />
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-center justify-between">
                      <span
                        className="size-2.5 rounded-full shadow-[0_0_18px_currentColor]"
                        style={{
                          color: activeColor,
                          backgroundColor: powered.length
                            ? activeColor
                            : 'hsl(var(--muted-foreground) / 0.3)',
                        }}
                      />
                      <ArrowUpRight className="size-5 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>

                    <div className="my-4 min-h-28 flex-1 overflow-hidden rounded-[1.45rem] border border-white/5 bg-background/25">
                      <Preview devices={roomDevices} />
                    </div>

                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-xl font-semibold tracking-[-0.045em]">
                          {group.name}
                        </h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {powered.length > 0
                            ? `${powered.length} active`
                            : 'All quiet'}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5 text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground">
                        <span className="rounded-full bg-muted/60 px-2.5 py-1.5">
                          {controllable.length} control
                        </span>
                        {sensorCount > 0 ? (
                          <span className="rounded-full bg-muted/60 px-2.5 py-1.5">
                            {sensorCount} sense
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Layers3;
  value: number;
  label: string;
}) {
  return (
    <div className="min-w-24 rounded-[1.35rem] border border-border/45 bg-background/35 p-3.5 backdrop-blur-sm">
      <Icon className="mb-4 size-4 text-primary" />
      <div className="text-2xl font-semibold leading-none tracking-[-0.06em] tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
