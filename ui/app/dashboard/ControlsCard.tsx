'use client';

import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useWebsocket, useWebsocketState } from '@/hooks/websocket';
import { produce } from 'immer';
import { Bot, Car, LampCeiling } from 'lucide-react';
import { useState } from 'react';
import { Button, Card } from 'react-daisyui';

const lightDeviceKey = 'hue1/c72e661d-9918-4070-afa6-767ddbeaf687';
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
  const [vacuumActive, setVacuumActive] = useState(false);

  const carHeaterDevice = state?.devices[carHeaterDeviceKey];
  if (carHeaterDevice && 'Controllable' in carHeaterDevice.data) {
    carHeater = carHeaterDevice.data.Controllable.state.power;
  }

  const carHeaterRawValues = carHeaterDevice?.raw;
  let carHeaterLoading = false;
  if (carHeater && carHeaterRawValues) {
    // https://developer.tuya.com/en/docs/connect-subdevices-to-gateways/tuya-zigbee-measuring-smart-plug-access-standard?id=K9ik6zvofpzqk#title-15-DP19%20Power
    // Value seems to be in units of 0.1W
    const carHeaterPowerValue = (carHeaterRawValues['19'] ?? 0) / 10;
    carHeaterLoading = carHeaterPowerValue < 1400;
  }

  const toggleCarHeater = () => {
    if (carHeaterDevice) {
      const device = produce(carHeaterDevice, (draft) => {
        if ('Controllable' in draft.data) {
          draft.data.Controllable.state.power = !carHeater;
          draft.data.Controllable.scene = null;
        }
      });

      const msg: WebSocketRequest = {
        Message: {
          SetExpectedState: {
            device,
            set_scene: true,
            skip_send: false,
          },
        },
      };

      const data = JSON.stringify(msg);
      ws?.send(data);
    }
  };

  const toggleLights = () => {
    const msg: WebSocketRequest = {
      Message: {
        Action: {
          action: 'ForceTriggerRoutine',
          routine_id: lightsOn ? 'leave_home' : 'entryway',
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);
  };

  const cleanHouse = () => {
    const msg: WebSocketRequest = {
      Message: {
        Action: {
          action: 'Custom',
          integration_id: 'neato',
          payload: vacuumActive ? 'stop_cleaning' : 'clean_house_force',
        },
      },
    };

    const data = JSON.stringify(msg);
    ws?.send(data);

    setVacuumActive(!vacuumActive);
  };

  return (
    <Card compact className="col-span-2">
      <Card.Body className="flex-row items-center justify-around overflow-x-auto shadow-lg">
        <Button
          color="ghost"
          className={lightsOn ? '' : 'text-zinc-700'}
          size="lg"
          startIcon={<LampCeiling size="3rem" />}
          onClick={toggleLights}
        />
        <Button
          color="ghost"
          className={vacuumActive ? '' : 'text-zinc-700'}
          size="lg"
          startIcon={<Bot size="3rem" />}
          onClick={cleanHouse}
        />
        <Button
          color="ghost"
          className={carHeater ? '' : 'text-zinc-700'}
          size="lg"
          startIcon={<Car size="3rem" />}
          onClick={toggleCarHeater}
          loading={carHeaterLoading}
        />
      </Card.Body>
    </Card>
  );
};
