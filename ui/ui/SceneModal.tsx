import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSceneModalState } from '@/hooks/sceneModalState';
import { useScenesState, useWebsocket } from '@/hooks/websocket';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';
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
  const scenes = useScenesState();

  const {
    open: sceneModalOpen,
    setOpen: setSceneModalOpen,
    state: sceneModalState,
  } = useSceneModalState();

  const scene =
    sceneModalState !== null && scenes !== null
      ? scenes[sceneModalState]
      : null;

  const { visible, close } = props;

  const [value, setValue] = useState(scene?.name ?? '');
  useEffect(() => {
    setValue(scene?.name ?? '');
  }, [scene, sceneModalOpen]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.currentTarget.value);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (sceneModalState === null) return;

    const msg: WebSocketRequest = {
      EventMessage: {
        DbEditScene: {
          scene_id: sceneModalState,
          name: value,
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
    setSceneModalOpen(false);
  };

  const [askDeleteConfirmation, setAskDeleteConfirmation] = useState(false);

  useEffect(() => {
    setAskDeleteConfirmation(false);
  }, [sceneModalOpen]);

  const handleDelete = () => {
    if (sceneModalState === null) return;

    const msg: WebSocketRequest = {
      EventMessage: {
        DbDeleteScene: {
          scene_id: sceneModalState,
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
    setSceneModalOpen(false);
    setAskDeleteConfirmation(false);
  };

  return (
    <ResponsiveOverlay
      open={visible}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close();
        }
      }}
      title={scene?.name ? `Edit ${scene.name}` : 'Edit scene'}
      description="Rename or delete this scene. Deleting a scene cannot be undone."
    >
      <form className="space-y-5 px-5 pb-5 md:px-0 md:pb-0" onSubmit={submit}>
        <div className="space-y-2">
          <Label htmlFor="scene-edit-name">Scene name</Label>
          <Input
            id="scene-edit-name"
            autoFocus
            onChange={handleChange}
            value={value}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (askDeleteConfirmation) {
                handleDelete();
                return;
              }

              setAskDeleteConfirmation(true);
            }}
          >
            {askDeleteConfirmation ? 'Confirm delete' : 'Delete scene'}
          </Button>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={value.trim().length === 0}>
              Save changes
            </Button>
          </div>
        </div>
      </form>
    </ResponsiveOverlay>
  );
};

export const SceneModal = () => {
  const { open: sceneModalOpen, setOpen: setSceneModalOpen } =
    useSceneModalState();

  return (
    <Component
      visible={sceneModalOpen}
      close={() => setSceneModalOpen(false)}
    />
  );
};
