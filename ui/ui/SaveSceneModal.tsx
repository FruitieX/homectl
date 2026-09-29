import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { useDevicesState } from '@/hooks/websocket';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { useAppConfig } from '@/hooks/appConfig';
import { useScenes, type Scene } from '@/hooks/useConfig';
import { captureSceneDeviceState } from '@/lib/sceneCapture';
import { isDeviceReadOnly } from '@/lib/deviceCapabilities';
import { entityDraftStore } from '@/lib/entityDraft';
import { suggestId } from '@/lib/groupGraph';
import { createUuid } from '@/lib/uuid';
import { LiveStatePreview, devicePreviewState } from '@/ui/LiveStatePreview';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Label } from '@/ui/primitives/label';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';

/** Capture is an unsaved canonical editor draft, never a fire-and-forget write. */
export const SaveSceneModal = () => {
  const { open, setOpen } = useSaveSceneModalState();
  const devices = useDevicesState();
  const [selectedKeys] = useSelectedDevices();
  const { apiEndpoint } = useAppConfig();
  const scenes = useScenes();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName('');
  }, [open]);
  const selected = [...new Set(selectedKeys)].flatMap((key) => {
    const device = devices?.[key];
    return device && 'Controllable' in device.data && !isDeviceReadOnly(device)
      ? [{ key, device, capture: captureSceneDeviceState(device) }]
      : [];
  });
  const skipped = new Set(selectedKeys).size - selected.length;
  function review(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !selected.length) return;
    const capture = createUuid();
    const params = new URLSearchParams({
      capture,
      returnTo: location.pathname + location.search,
    });
    const href = `/config/scenes/new?${params}`;
    const key = `${apiEndpoint}/scenes/$new/${capture}`;
    const empty: Scene = {
      id: '',
      name: '',
      hidden: false,
      device_states: {},
      group_states: {},
    };
    entityDraftStore.sync(key, empty, { label: 'New scene', href });
    entityDraftStore.change(key, {
      ...empty,
      id: suggestId(
        name.trim(),
        scenes.data.map((s) => s.id),
      ),
      name: name.trim(),
      device_states: Object.fromEntries(
        selected.map(({ key, capture }) => [key, capture.state]),
      ),
    });
    setOpen(false);
    navigate(href);
  }
  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={setOpen}
      title="Capture scene"
      description="Review the selected devices’ requested states before creating a scene. This does not change your lights."
    >
      <form className="space-y-4 px-5 pb-5 md:px-0 md:pb-0" onSubmit={review}>
        <div className="space-y-2">
          <Label htmlFor="capture-scene-name">Scene name</Label>
          <Input
            id="capture-scene-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Evening lights"
          />
        </div>
        <div className="max-h-72 divide-y divide-border overflow-y-auto">
          {selected.map(({ key, device, capture }) => (
            <div key={key} className="flex items-start gap-3 py-2">
              <LiveStatePreview states={[devicePreviewState(device)]} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{device.name}</p>
                {capture.notes.map((note) => (
                  <p key={note} className="text-xs text-muted-foreground">
                    {note}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {selected.length} controllable devices captured by stable device ID.
          {skipped > 0
            ? ` ${skipped} unavailable, sensor or read-only selections skipped.`
            : ''}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              !name.trim() ||
              !selected.length ||
              scenes.loading ||
              Boolean(scenes.error)
            }
          >
            Review scene
          </Button>
        </div>
        {scenes.error && (
          <p role="alert" className="text-sm text-destructive">
            Could not load existing scenes.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => void scenes.refetch()}
            >
              Retry
            </button>
          </p>
        )}
      </form>
    </ResponsiveOverlay>
  );
};
