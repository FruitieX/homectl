import { Button, Input, Modal } from 'react-daisyui';
import { useCallback, useEffect, useState } from 'react';
import { useSceneModalState } from '@/hooks/sceneModalState';
import { useWebsocket, useWebsocketState } from '@/hooks/websocket';
import { WebSocketRequest } from '@/bindings/WebSocketRequest';

type Props = {
  visible: boolean;
  close: () => void;
};

const Component = (props: Props) => {
  const ws = useWebsocket();
  const state = useWebsocketState();

  const {
    open: sceneModalOpen,
    setOpen: setSceneModalOpen,
    state: sceneModalState,
  } = useSceneModalState();

  const scene =
    sceneModalState !== null && state?.scenes !== undefined
      ? state.scenes[sceneModalState]
      : null;

  const { visible, close } = props;

  const [value, setValue] = useState(scene?.name ?? '');
  useEffect(() => {
    setValue(scene?.name ?? '');
  }, [scene, sceneModalOpen]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.currentTarget.value;
    setValue(newValue);
  }, []);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();

      if (sceneModalState === null) return;

      const msg: WebSocketRequest = {
        Message: {
          EditScene: {
            scene_id: sceneModalState,
            name: value,
          },
        },
      };

      const data = JSON.stringify(msg);
      ws?.send(data);
      setSceneModalOpen(false);
    },
    [sceneModalState, setSceneModalOpen, value, ws],
  );

  const [askDeleteConfirmation, setAskDeleteConfirmation] = useState(false);

  useEffect(() => {
    setAskDeleteConfirmation(false);
  }, [sceneModalOpen]);

  const handleDelete = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      if (sceneModalState === null) return;

      const msg: WebSocketRequest = {
        Message: {
          DeleteScene: {
            scene_id: sceneModalState,
          },
        },
      };

      const data = JSON.stringify(msg);
      ws?.send(data);
      setSceneModalOpen(false);
      setAskDeleteConfirmation(false);
    },
    [sceneModalState, setSceneModalOpen, ws],
  );

  const handleAskConfirmation = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setAskDeleteConfirmation(true);
    },
    [],
  );

  return (
    <Modal responsive open={visible} onClickBackdrop={close}>
      <Button
        size="sm"
        shape="circle"
        className="absolute right-2 top-2"
        onClick={close}
      >
        ✕
      </Button>
      <Modal.Header className="font-bold">{`Edit scene ${scene?.name}`}</Modal.Header>

      <form onSubmit={submit}>
        <Modal.Body>
          <label className="label">
            <span className="label-text">Scene name</span>
          </label>
          <Input onChange={handleChange} value={value} />
        </Modal.Body>

        <Modal.Actions>
          <Button
            color="error"
            onClick={
              askDeleteConfirmation ? handleDelete : handleAskConfirmation
            }
          >
            {askDeleteConfirmation ? 'Confirm?' : 'Delete'}
          </Button>
          <Button type="submit" onClick={submit}>
            Save
          </Button>
        </Modal.Actions>
      </form>
    </Modal>
  );
};

export const SceneModal = () => {
  const { open: sceneModalOpen, setOpen: setSceneModalOpen } =
    useSceneModalState();

  const closeSceneModal = useCallback(() => {
    setSceneModalOpen(false);
  }, [setSceneModalOpen]);

  return <Component visible={sceneModalOpen} close={closeSceneModal} />;
};
