'use client';

import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useWebsocket, useWebsocketState } from '@/hooks/websocket';
import { produce } from 'immer';
import { Car, Edit, LampCeiling, X } from 'lucide-react';
import { Button, Card, Modal } from 'react-daisyui';
import { useTimeout, useToggle } from 'usehooks-ts';
import dynamicImport from 'next/dynamic';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { useCallback, useEffect } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useCarHeaterModalOpenState } from '@/hooks/carHeaterModalState';
import useIdle from '@/hooks/useIdle';
import clsx from 'clsx';

const lightDeviceKey = 'tuya/bf25d876e90e147950dnm2';
const carHeaterDeviceKey = 'tuya_devices/bfe553b84e883ace37nvxw';
export const ControlsCard = () => {
  const ws = useWebsocket();
  const state = useWebsocketState();

  let lightsOn = false;
  const lightDevice = state?.devices[lightDeviceKey];
  if (lightDevice && 'Controllable' in lightDevice.data) {
    lightsOn = lightDevice.data.Controllable.state.power;
  }

  let carHeater = false;
  // const [vacuumActive, setVacuumActive] = useState(false);

  const carHeaterDevice = state?.devices[carHeaterDeviceKey];
  if (carHeaterDevice && 'Controllable' in carHeaterDevice.data) {
    carHeater = carHeaterDevice.data.Controllable.state.power;
  }

  const carHeaterRawValues = carHeaterDevice?.raw;
  let carHeaterLoading = false;
  if (carHeater && carHeaterRawValues) {
    // https://developer.tuya.com/en/docs/connect-subdevices-to-gateways/tuya-zigbee-measuring-smart-plug-access-standard?id=K9ik6zvofpzqk#title-15-DP19%20Power
    // Value seems to be in units of 10W
    const carHeaterPowerValue = (carHeaterRawValues['19'] ?? 0) / 10;
    carHeaterLoading = carHeaterPowerValue < 1400;
  }

  const toggleCarHeater = (power?: boolean) => {
    if (carHeaterDevice) {
      const device = produce(carHeaterDevice, (draft) => {
        if ('Controllable' in draft.data) {
          draft.data.Controllable.state.power = power ?? !carHeater;
          draft.data.Controllable.scene_id = null;
        }
      });

      const msg: WebSocketRequest = {
        EventMessage: {
          SetInternalState: {
            device,
            skip_external_update: false,
          },
        },
      };

      const data = JSON.stringify(msg);
      ws?.send(data);
    }
  };

  /*
  const toggleLights = () => {
    const msg: WebSocketRequest = {
      EventMessage: {
        Action: {
          action: 'ForceTriggerRoutine',
          routine_id: lightsOn ? 'leave_home' : 'entryway',
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
  };
  */

  // const cleanHouse = () => {
  //   const msg: WebSocketRequest = {
  //     EventMessage: {
  //       Action: {
  //         action: 'Custom',
  //         integration_id: 'neato',
  //         payload: vacuumActive ? 'stop_cleaning' : 'clean_house_force',
  //       },
  //     },
  //   };

  //   const data = JSON.stringify(msg);
  //   ws?.send(data);

  //   setVacuumActive(!vacuumActive);
  // };

  const isIdle = useIdle();
  const [mapVisible, toggleMapVisible, setMapVisible] = useToggle(false);

  useTimeout(
    () => {
      setMapVisible(false);
    },
    isIdle && mapVisible ? 60 * 1000 : null,
  );

  const [selectedDevices, setSelectedDevices] = useSelectedDevices();
  const { setState: setDeviceModalState, setOpen: setDeviceModalOpen } =
    useDeviceModalState();

  const clearSelectedDevices = useCallback(() => {
    setSelectedDevices([]);
  }, [setSelectedDevices]);

  useEffect(() => {
    clearSelectedDevices();
  }, [mapVisible, clearSelectedDevices]);

  const editSelectedDevices = useCallback(() => {
    setDeviceModalState(selectedDevices);
    setDeviceModalOpen(true);
  }, [selectedDevices, setDeviceModalOpen, setDeviceModalState]);

  const carHeaterModalOpenState = useCarHeaterModalOpenState();

  useTimeout(
    () => {
      carHeaterModalOpenState.setOpen(false);
    },
    carHeaterModalOpenState.open && isIdle ? 60 * 1000 : null,
  );

  return (
    <>
      <Card compact className="col-span-1 bg-base-300">
          <Button
            color="ghost"
            className={clsx(carHeater ? '' : 'text-zinc-700', 'h-full')}
            size="lg"
            startIcon={<Car size="3rem" />}
            onClick={() => toggleCarHeater()}
            onContextMenu={() => carHeaterModalOpenState.setOpen(true)}
            loading={carHeaterLoading}
            >
        {/* <Card.Body className="flex-row items-center justify-around overflow-x-auto"> */}
          {/* <Button
            color="ghost"
            className={lightsOn ? '' : 'text-zinc-700'}
            size="lg"
            startIcon={<LampCeiling size="3rem" />}
            onClick={toggleMapVisible}
          /> */}
          {/* <Button
          color="ghost"
          className={vacuumActive ? '' : 'text-zinc-700'}
          size="lg"
          startIcon={<Bot size="3rem" />}
          onClick={cleanHouse}
        /> */}
        {/* </Card.Body> */}
</Button>
      </Card>
      <Modal.Legacy
        responsive
        open={mapVisible}
        onClickBackdrop={toggleMapVisible}
        className="h-svh! pt-0 overflow-hidden"
      >
        <Modal.Header className="gap-3 flex items-center justify-between font-bold sticky w-auto top-0 p-6 m-0 -mx-6 z-10 bg-base-100 bg-opacity-75 backdrop-blur-sm">
          <div className="mx-4 text-center">Floorplan</div>
          <div className="flex-1" />
          {selectedDevices.length > 0 && (
            <Button
              color="ghost"
              startIcon={<Edit />}
              onClick={editSelectedDevices}
            />
          )}
          <Button onClick={toggleMapVisible} variant="outline">
            <X />
          </Button>
        </Modal.Header>
        {mapVisible && <NoSSRViewport />}
      </Modal.Legacy>
    </>
  );
};

const NoSSRViewport = dynamicImport(() => import('../map/Viewport'), {
  ssr: false,
});
