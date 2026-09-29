import { useRef, useState } from 'react';
import { createUuid } from '@/lib/uuid';
import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { Check, ExternalLink, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useConnectionStatus,
  useDevicesState,
  useScenesState,
  useWebsocket,
} from '@/hooks/websocket';
import { LiveStatePreview } from '@/ui/LiveStatePreview';
import { configItemHref } from '@/lib/configItemHref';
import { useDeviceModalState } from '@/hooks/deviceModalState';
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
type Props = {
  deviceKeys: string[];
  showAll?: boolean;
  compact?: boolean;
  sceneIds?: string[];
  allowPins?: boolean;
  layout?: 'rows' | 'tiles' | 'strip';
};

export function SceneList({
  deviceKeys,
  showAll,
  compact,
  sceneIds,
  allowPins = true,
  layout = 'rows',
}: Props) {
  const navigate = useNavigate();
  const ws = useWebsocket();
  const connected = useConnectionStatus() === 'connected';
  const scenes = useScenesState();
  const devices = useDevicesState();
  const deviceModal = useDeviceModalState();
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
      if (
        !scene ||
        (sceneIds ? !sceneIds.includes(id) : !showAll && scene.hidden)
      )
        return [];
      const targets = Object.keys(scene.devices).filter(
        (key) =>
          selected.has(key) &&
          devices?.[key] &&
          'Controllable' in devices[key]!.data &&
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
                device.data.Controllable.scene_id === id &&
                !device.data.Controllable.scene_paused
              );
            }),
        },
      ];
    })
    .sort(
      (a, b) =>
        (sceneIds
          ? sceneIds.indexOf(a.id) - sceneIds.indexOf(b.id)
          : allowPins
            ? Number(pins.includes(b.id)) - Number(pins.includes(a.id))
            : 0) || a.scene.name.localeCompare(b.scene.name),
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
        request_id: createUuid(),
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
        <div
          className={
            layout === 'strip'
              ? 'flex flex-wrap gap-2'
              : layout === 'tiles'
                ? 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-2'
                : 'divide-y divide-border'
          }
        >
          {visible.map(({ id, scene, targets, active }) => (
            <div
              key={id}
              className={cn(
                'flex min-w-0 items-center gap-1 py-1 transition-colors',
                layout !== 'rows' &&
                  'rounded-lg border border-border bg-card px-2',
                layout === 'strip' && 'max-w-full',
                active && 'text-primary',
              )}
            >
              <button
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                  layout === 'strip' ? 'min-h-11 py-1' : 'min-h-14 py-2',
                )}
                aria-label={`Activate ${scene.name}`}
                title={scene.name}
                aria-pressed={active}
                disabled={
                  !connected || pendingScene !== null || targets.length === 0
                }
                aria-busy={pendingScene === id}
                onClick={() => activate(id, targets)}
              >
                <LiveStatePreview
                  states={targets.map((key) => scene.devices[key])}
                  size={layout === 'strip' ? 26 : 36}
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 break-words text-sm font-medium">
                    {scene.name}
                  </span>
                  <span
                    className={cn(
                      'mt-1 block text-xs text-muted-foreground',
                      layout === 'strip' && pendingScene !== id && 'sr-only',
                    )}
                  >
                    {pendingScene === id
                      ? 'Applying…'
                      : active
                        ? `Active · ${targets.length} ${targets.length === 1 ? 'device' : 'devices'}`
                        : `${targets.length} ${targets.length === 1 ? 'device' : 'devices'}`}
                  </span>
                </span>
                {active && (
                  <Check aria-hidden className="size-4 shrink-0 text-primary" />
                )}
              </button>
              <Button
                className="shrink-0"
                size="icon"
                variant="ghost"
                aria-label={`Edit ${scene.name} in scene settings`}
                title="Edit in scene settings"
                onClick={() => {
                  deviceModal.setOpen(false);
                  navigate(configItemHref('scene', id));
                }}
              >
                <ExternalLink />
              </Button>
              {allowPins && (
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
