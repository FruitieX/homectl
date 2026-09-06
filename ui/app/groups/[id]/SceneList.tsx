import { useState } from 'react';
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
import type { WebSocketRequest } from '@/bindings/WebSocketRequest';
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

  function activate(sceneId: string, targets: string[]) {
    if (!ws || ws.readyState !== WebSocket.OPEN || targets.length === 0) return;
    const request: WebSocketRequest = {
      EventMessage: {
        Action: {
          action: 'ActivateScene',
          scene_id: sceneId,
          device_keys: targets,
          group_keys: null,
          mirror_from_group: null,
          include_source_groups: false,
          use_scene_transition: false,
          transition: null,
          rollout: null,
          rollout_source_device_key: null,
          rollout_duration_ms: null,
        },
      },
    };
    try {
      ws.send(JSON.stringify(request));
    } catch {
      toast.error('Could not send the scene change.');
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
                disabled={!connected || targets.length === 0}
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
                    {active
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
