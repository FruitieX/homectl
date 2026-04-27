import { WebSocketRequest } from '@/bindings/WebSocketRequest';
import { useDeviceState, useWebsocket } from '@/hooks/websocket';
import { produce } from 'immer';
import { Car, Edit, LampCeiling, X } from 'lucide-react';
import { useTimeout, useToggle } from 'usehooks-ts';
import Viewport from '../map/Viewport';
import { useSelectedDevices } from '@/hooks/selectedDevices';
import { useEffect } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useCarHeaterModalOpenState } from '@/hooks/carHeaterModalState';
import useIdle from '@/hooks/useIdle';
import clsx from 'clsx';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';

const lightDeviceKey = 'tuya/bf25d876e90e147950dnm2';
const carHeaterDeviceKey = 'tuya_devices/bfe553b84e883ace37nvxw';
export const ControlsCard = () => {
  const ws = useWebsocket();

  let lightsOn = false;
  const lightDevice = useDeviceState(lightDeviceKey);
  if (lightDevice && 'Controllable' in lightDevice.data) {
    lightsOn = lightDevice.data.Controllable.state.power;
  }

  let carHeater = false;
  // const [vacuumActive, setVacuumActive] = useState(false);

  const carHeaterDevice = useDeviceState(carHeaterDeviceKey);
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
            skip_db_update: null,
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

  useEffect(() => {
    setSelectedDevices([]);
  }, [mapVisible, setSelectedDevices]);

  const editSelectedDevices = () => {
    setDeviceModalState(selectedDevices);
    setDeviceModalOpen(true);
  };

  const carHeaterModalOpenState = useCarHeaterModalOpenState();

  useTimeout(
    () => {
      carHeaterModalOpenState.setOpen(false);
    },
    carHeaterModalOpenState.open && isIdle ? 60 * 1000 : null,
  );

  return (
    <>
      <Card className="col-span-1 h-full overflow-hidden">
        <CardContent className="h-full p-0">
          <Button
            variant="ghost"
            className={clsx(
              carHeater ? '' : 'opacity-30',
              'h-full w-full justify-center rounded-3xl',
            )}
            size="lg"
            onClick={() => toggleCarHeater()}
            onContextMenu={() => carHeaterModalOpenState.setOpen(true)}
          >
            {carHeaterLoading ? (
              <span className="size-8 animate-spin rounded-full border-4 border-current border-t-transparent" />
            ) : (
              <Car size="3rem" />
            )}
            <span className="sr-only">Toggle car heater</span>
          </Button>
        </CardContent>
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
      </Card>
      <ResponsiveOverlay
        open={mapVisible}
        onOpenChange={setMapVisible}
        title="Floorplan"
        description="Quick access to floorplan device controls from the dashboard."
        className="max-w-6xl"
      >
        <div className="space-y-3 px-5 pb-5 md:px-0 md:pb-0">
          <div className="flex items-center justify-end gap-2">
            {selectedDevices.length > 0 && (
              <Button variant="ghost" size="icon" onClick={editSelectedDevices}>
                <Edit />
              </Button>
            )}
            <Button onClick={toggleMapVisible} variant="outline" size="icon">
              <X />
            </Button>
          </div>
          <div className="relative h-[70dvh] overflow-hidden rounded-3xl border border-border bg-background">
            {mapVisible && <Viewport />}
          </div>
        </div>
      </ResponsiveOverlay>
    </>
  );
};
