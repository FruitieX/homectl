import { useAppConfig } from '@/hooks/appConfig';
import { useSetDeviceState } from '@/hooks/useSetDeviceColor';
import {
  useConnectionStatus,
  useDevicesState,
  useGroupsState,
  useRoutineStatuses,
  useScenesState,
} from '@/hooks/websocket';
import { getColor, getPower } from '@/lib/colors';
import { getDeviceKey } from '@/lib/device';
import { Button } from '@/ui/primitives/button';
import { type Device } from '@/bindings/Device';
import { type FlattenedGroupConfig } from '@/bindings/FlattenedGroupConfig';
import {
  ArrowRight,
  Bolt,
  Home,
  LampDesk,
  Layers3,
  Map,
  MoonStar,
  Power,
  Radio,
  Sparkles,
  ThermometerSun,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import Preview from '../groups/Preview';

function getGreeting(hour: number) {
  if (hour < 5) return 'Still up?';
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function isControllable(device: Device) {
  return 'Controllable' in device.data;
}

function getGroupDevices(group: FlattenedGroupConfig, devices: Device[]) {
  const keys = new Set(group.device_keys);
  return devices.filter((device) => keys.has(getDeviceKey(device)));
}

function getRoomAccent(devices: Device[]) {
  const activeDevice = devices.find(
    (device) => isControllable(device) && getPower(device.data),
  );
  return activeDevice ? getColor(activeDevice.data).hex() : '#5e9e7d';
}

export function HomeOverview() {
  const { apiEndpoint } = useAppConfig();
  const devicesState = useDevicesState();
  const groupsState = useGroupsState();
  const scenesState = useScenesState();
  const routineStatuses = useRoutineStatuses();
  const connectionStatus = useConnectionStatus();
  const setDeviceState = useSetDeviceState();
  const [now, setNow] = useState(() => new Date());
  const [activatingSceneId, setActivatingSceneId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const devices = useMemo(
    () =>
      Object.values(devicesState ?? {}).filter(
        (device): device is Device => device !== undefined,
      ),
    [devicesState],
  );
  const controllableDevices = devices.filter(isControllable);
  const poweredDevices = controllableDevices.filter((device) =>
    getPower(device.data),
  );
  const sensors = devices.length - controllableDevices.length;
  const groups = Object.entries(groupsState ?? {})
    .filter(
      (entry): entry is [string, FlattenedGroupConfig] =>
        entry[1] !== undefined && !entry[1].hidden,
    )
    .sort((left, right) => left[1].name.localeCompare(right[1].name));
  const scenes = Object.entries(scenesState ?? {})
    .filter(([, scene]) => scene !== undefined && !scene.hidden)
    .sort((left, right) => left[1]!.name.localeCompare(right[1]!.name))
    .slice(0, 5);
  const readyRoutines = Object.values(routineStatuses ?? {}).filter(
    (status) => status?.all_conditions_match,
  ).length;
  const connected = connectionStatus === 'connected';

  const turnEverythingOff = () => {
    for (const device of poweredDevices) {
      setDeviceState(device, false, false, undefined, undefined, 0.35);
    }
    toast.success(
      poweredDevices.length === 0
        ? 'Everything is already off'
        : `Turning off ${poweredDevices.length} active ${poweredDevices.length === 1 ? 'device' : 'devices'}`,
    );
  };

  const activateScene = async (sceneId: string, sceneName: string) => {
    try {
      setActivatingSceneId(sceneId);
      const response = await fetch(`${apiEndpoint}/api/v1/actions/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ActivateScene', scene_id: sceneId }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success(`${sceneName} is coming alive`);
    } catch (cause) {
      toast.error(
        cause instanceof Error && cause.message
          ? cause.message
          : `Could not activate ${sceneName}`,
      );
    } finally {
      setActivatingSceneId(null);
    }
  };

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[2rem] border border-border/45 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--card)/0.64))] p-5 shadow-[0_24px_80px_rgba(18,31,25,0.09)] sm:p-7 lg:min-h-[20rem] lg:p-9">
        <div className="pointer-events-none absolute -right-16 -top-24 size-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-chart-3/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)] lg:items-end">
          <div>
            <div className="mb-8 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {connected ? (
                <Radio className="size-3.5 text-emerald-500" />
              ) : (
                <WifiOff className="size-3.5 text-amber-500" />
              )}
              {connected ? 'Home is live' : 'Restoring live connection'}
            </div>
            <h2 className="max-w-3xl text-[clamp(2.5rem,7vw,5.6rem)] font-semibold leading-[0.9] tracking-[-0.075em]">
              {getGreeting(now.getHours())}
            </h2>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              {poweredDevices.length > 0
                ? `${poweredDevices.length} ${poweredDevices.length === 1 ? 'device is' : 'devices are'} active across your home.`
                : 'The house is quiet. Everything controllable is currently off.'}
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <Button
                onClick={turnEverythingOff}
                disabled={!connected}
                className="rounded-2xl shadow-[0_12px_30px_hsl(var(--primary)/0.2)]"
              >
                <Power />
                All off
              </Button>
              <Button
                asChild
                variant="outline"
                className="rounded-2xl bg-card/45"
              >
                <Link to="/map">
                  <Map />
                  Open floorplan
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
            <PulseMetric
              icon={LampDesk}
              value={poweredDevices.length}
              label="Active"
              tone="warm"
            />
            <PulseMetric
              icon={Layers3}
              value={groups.length}
              label="Rooms"
              tone="green"
            />
            <PulseMetric
              icon={ThermometerSun}
              value={sensors}
              label="Sensors"
              tone="blue"
            />
            <PulseMetric
              icon={Bolt}
              value={readyRoutines}
              label="Ready"
              tone="violet"
            />
          </div>
        </div>
      </section>

      {scenes.length > 0 ? (
        <section>
          <SectionHeading
            eyebrow="One touch"
            title="Set the mood"
            action={<Sparkles className="size-4 text-primary" />}
          />
          <div className="flex gap-2.5 overflow-x-auto pb-2">
            {scenes.map(([sceneId, scene], index) => {
              if (!scene) return null;
              const targetKeys = Object.keys(scene.devices);
              const active =
                targetKeys.length > 0 &&
                targetKeys.every((deviceKey) => {
                  const device = devicesState?.[deviceKey];
                  return (
                    device &&
                    'Controllable' in device.data &&
                    device.data.Controllable.scene_id === sceneId
                  );
                });
              return (
                <button
                  key={sceneId}
                  onClick={() => activateScene(sceneId, scene.name)}
                  disabled={activatingSceneId !== null || !connected}
                  className="group relative min-h-28 min-w-[10.5rem] flex-1 overflow-hidden rounded-[1.6rem] border border-border/50 bg-card/75 p-4 text-left shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-xl disabled:pointer-events-none disabled:opacity-55"
                >
                  <div
                    className="absolute inset-0 opacity-50 transition-opacity group-hover:opacity-75"
                    style={{
                      background: `radial-gradient(circle at 85% 15%, hsl(var(--chart-${(index % 5) + 1}) / 0.26), transparent 48%)`,
                    }}
                  />
                  <div className="relative flex h-full flex-col justify-between gap-5">
                    <div className="flex items-center justify-between">
                      <MoonStar className="size-4 text-muted-foreground" />
                      {active ? (
                        <span className="rounded-full bg-primary/12 px-2 py-1 text-[0.62rem] font-bold uppercase tracking-wider text-primary">
                          Active
                        </span>
                      ) : null}
                    </div>
                    <div>
                      <div className="truncate font-semibold tracking-[-0.025em]">
                        {scene.name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {targetKeys.length} targets
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {groups.length > 0 ? (
        <section>
          <SectionHeading
            eyebrow="Live spaces"
            title="Around the house"
            action={
              <Link
                to="/groups"
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                All rooms <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {groups.slice(0, 4).map(([groupId, group]) => {
              const roomDevices = getGroupDevices(group, devices);
              const on = roomDevices.filter(
                (device) => isControllable(device) && getPower(device.data),
              ).length;
              const accent = getRoomAccent(roomDevices);
              return (
                <Link
                  key={groupId}
                  to={`/groups/${groupId}`}
                  className="group relative min-h-44 overflow-hidden rounded-[1.7rem] border border-border/50 bg-card/72 p-4 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-xl"
                >
                  <div
                    className="absolute inset-0 opacity-70 transition group-hover:opacity-100"
                    style={{
                      background: `radial-gradient(circle at 82% 22%, ${accent}32, transparent 52%)`,
                    }}
                  />
                  <div className="relative flex h-full items-stretch gap-3">
                    <div className="flex min-w-0 flex-1 flex-col justify-between">
                      <Home className="size-4 text-muted-foreground" />
                      <div>
                        <h3 className="truncate text-lg font-semibold tracking-[-0.04em]">
                          {group.name}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {on > 0 ? `${on} active now` : 'Quiet'} ·{' '}
                          {roomDevices.length} devices
                        </p>
                      </div>
                    </div>
                    <div className="w-24 shrink-0 overflow-hidden rounded-[1.3rem] border border-white/5 bg-background/30">
                      <Preview devices={roomDevices} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PulseMetric({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof LampDesk;
  value: number;
  label: string;
  tone: 'warm' | 'green' | 'blue' | 'violet';
}) {
  const toneClass = {
    warm: 'bg-amber-500/12 text-amber-600 dark:text-amber-300',
    green: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
    blue: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-300',
    violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-300',
  }[tone];

  return (
    <div className="rounded-[1.45rem] border border-border/45 bg-background/38 p-3.5 backdrop-blur-sm">
      <div
        className={`mb-5 grid size-8 place-items-center rounded-xl ${toneClass}`}
      >
        <Icon className="size-4" />
      </div>
      <div className="text-2xl font-semibold leading-none tracking-[-0.06em] tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4 px-1">
      <div>
        <div className="text-[0.62rem] font-bold uppercase tracking-[0.2em] text-primary">
          {eyebrow}
        </div>
        <h2 className="mt-1 text-xl font-semibold tracking-[-0.045em]">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
