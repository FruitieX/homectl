import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { useDevicesState, useWebsocket } from '@/hooks/websocket';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { SceneConfig } from '@/bindings/SceneConfig';
import { SceneDeviceState } from '@/bindings/SceneDeviceState';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { SceneDevicesSearchConfig } from '@/bindings/SceneDevicesSearchConfig';
import { ExcludeUndefined } from 'utils/excludeUndefined';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { Label } from '@/ui/primitives/label';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';

type Props = {
  visible: boolean;
  close: () => void;
};

const Component = (props: Props) => {
  const ws = useWebsocket();
  const devices = useDevicesState();

  const { setOpen: setSaveSceneModalOpen } = useSaveSceneModalState();

  const [_selectedDevices, setSelectedDevices] = useSelectedDevices();
  const selectedDevices = _selectedDevices.flatMap((d) => {
    const device = devices?.[d];
    if (device !== null && device !== undefined) {
      return [device];
    }
    return [];
  });

  const { visible, close } = props;

  const [value, setValue] = useState('');

  useEffect(() => {
    if (visible) {
      setValue('');
    }
  }, [visible]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.currentTarget.value);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const sceneName = value.trim();
    if (!sceneName) {
      return;
    }

    const devicesByKey: (readonly [
      { integrationId: string; name: string },
      SceneDeviceState,
    ])[] = selectedDevices.flatMap((device) => {
      if ('Controllable' in device.data) {
        const light = device.data.Controllable;
        let color = { h: 0, s: 0 };

        if (
          light.state.color !== null &&
          'h' in light.state.color &&
          's' in light.state.color
        ) {
          color = light.state.color;
        }

        const state: SceneDeviceState = {
          power: light.state.power,
          color,
          brightness: light.state.brightness,
          transition: null,
        };

        return [
          [
            {
              integrationId: device.integration_id,
              name: device.name,
            },
            state,
          ] as const,
        ];
      }

      return [];
    });

    const devicesByIntegration: ExcludeUndefined<SceneDevicesSearchConfig> = {};

    devicesByKey.forEach(([deviceKey, state]) => {
      if (devicesByIntegration[deviceKey.integrationId] === undefined) {
        devicesByIntegration[deviceKey.integrationId] = {};
      }

      devicesByIntegration[deviceKey.integrationId][deviceKey.name] = state;
    });

    const config: SceneConfig = {
      name: sceneName,
      devices: devicesByIntegration,
      groups: null,
      hidden: false,
      script: null,
    };

    const msg: WebSocketRequest = {
      EventMessage: {
        DbStoreScene: {
          scene_id: sceneName,
          config,
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
    setSaveSceneModalOpen(false);
    setSelectedDevices([]);
  };

  return (
    <ResponsiveOverlay
      open={visible}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close();
        }
      }}
      title="Save new scene"
      description="Create a scene from the currently selected controllable devices."
    >
      <form className="space-y-5 px-5 pb-5 md:px-0 md:pb-0" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="scene-name">Scene name</Label>
          <Input
            id="scene-name"
            autoFocus
            onChange={handleChange}
            placeholder="Evening lights"
            value={value}
          />
          <p className="text-sm text-muted-foreground">
            {selectedDevices.length} selected{' '}
            {selectedDevices.length === 1 ? 'device' : 'devices'} will be saved.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={value.trim().length === 0}>
            Save scene
          </Button>
        </div>
      </form>
    </ResponsiveOverlay>
  );
};

export const SaveSceneModal = () => {
  const { open: saveSceneModalOpen, setOpen: setSaveSceneModalOpen } =
    useSaveSceneModalState();

  return (
    <Component
      visible={saveSceneModalOpen}
      close={() => setSaveSceneModalOpen(false)}
    />
  );
};
