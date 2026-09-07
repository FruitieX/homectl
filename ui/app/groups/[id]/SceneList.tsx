import { useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { Check, Star } from 'lucide-react';
import {
  useConnectionStatus,
  useDevicesState,
  useScenesState,
  useWebsocket,
} from '@/hooks/websocket';
import { useSceneModalState } from '@/hooks/sceneModalState';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { cn } from '@/lib/cn';
import { sendSceneCommand } from '@/lib/deviceCommands';
import { toast } from 'sonner';

const pinnedScenesAtom = atomWithStorage<string[]>(
  'homectl-pinned-scenes',
  [],
  undefined,
  { getOnInit: true },
);
type Props = { deviceKeys: string[]; showAll?: boolean; compact?: boolean };

export function SceneList({ deviceKeys, showAll, compact }: Props) {
  const ws = useWebsocket();
  const connected = useConnectionStatus() === 'connected';
  const scenes = useScenesState();
  const devices = useDevicesState();
  const modal = useSceneModalState();
  const [search, setSearch] = useState('');
  const [pendingScene, setPendingScene] = useState<string | null>(null);
  const sending = useRef(false);
  const [storedPins, setPins] = useAtom(pinnedScenesAtom);
  const pins = Array.isArray(storedPins)
    ? storedPins.filter((id) => typeof id === 'string')
    : [];
  const selected = new Set(deviceKeys);
  const eligible = Object.entries(scenes ?? {})
    .flatMap(([id, scene]) => {
      if (!scene || (!showAll && scene.hidden)) return [];
      const targets = Object.keys(scene.devices).filter(
        (key) =>
          selected.has(key) &&
          devices?.[key] &&
          !isDeviceReadOnly(devices[key]!),
      );
      if (!showAll && targets.length === 0) return [];
      return [
        {
          id,
          scene,
          targets,
          active:
            targets.length > 0 &&
            targets.every((key) => {
              const device = devices?.[key];
              return (
                device &&
                'Controllable' in device.data &&
                device.data.Controllable.scene_id === id
              );
            }),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(pins.includes(b.id)) - Number(pins.includes(a.id)) ||
        a.scene.name.localeCompare(b.scene.name),
    );
  const visible = eligible.filter(({ scene }) =>
    scene.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  async function activate(sceneId: string, targets: string[]) {
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      targets.length === 0 ||
      sending.current
    )
      return;
    sending.current = true;
    setPendingScene(sceneId);
    try {
      await sendSceneCommand(ws, {
        request_id: crypto.randomUUID(),
        scene_id: sceneId,
        device_keys: targets,
        group_keys: null,
        use_scene_transition: false,
        transition: null,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not apply the scene.',
        { id: 'scene-command-error' },
      );
    } finally {
      sending.current = false;
      setPendingScene(null);
    }
  }

  if (!scenes || !devices)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading scenes…
      </p>
    );
  return (
    <div
      className={compact ? 'space-y-3' : 'flex-1 space-y-3 overflow-y-auto p-3'}
    >
      {(eligible.length > 6 || search) && (
        <Input
          aria-label="Search scenes"
          placeholder="Search scenes…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {visible.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">
          {search
            ? 'No scenes match your search.'
            : 'No scenes target controllable devices in this selection.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {visible.map(({ id, scene, targets, active }) => (
            <div
              key={id}
              className={cn(
                'flex min-w-0 items-center rounded-xl border border-border bg-card transition-colors',
                active && 'border-primary bg-primary/10',
              )}
            >
              <button
                className="flex min-h-20 min-w-0 flex-1 items-center gap-2 rounded-xl p-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                aria-label={`Activate ${scene.name}`}
                title={scene.name}
                aria-pressed={active}
                disabled={
                  !connected || pendingScene !== null || targets.length === 0
                }
                aria-busy={pendingScene === id}
                onClick={() => activate(id, targets)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  modal.setState(id);
                  modal.setOpen(true);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 break-words font-medium">
                    {scene.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {pendingScene === id
                      ? 'Applying…'
                      : active
                        ? 'Active'
                        : `${targets.length} ${targets.length === 1 ? 'device' : 'devices'}`}
                  </span>
                </span>
                {active && (
                  <Check aria-hidden className="size-4 shrink-0 text-primary" />
                )}
              </button>
              <Button
                className="mr-1 shrink-0"
                size="icon"
                variant="ghost"
                aria-label={`${pins.includes(id) ? 'Unpin' : 'Pin'} ${scene.name}`}
                aria-pressed={pins.includes(id)}
                onClick={() =>
                  setPins(
                    pins.includes(id)
                      ? pins.filter((pin) => pin !== id)
                      : [...pins, id],
                  )
                }
              >
                <Star
                  className={
                    pins.includes(id)
                      ? 'fill-current text-primary'
                      : 'text-muted-foreground'
                  }
                />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
