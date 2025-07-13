import { Badge, Button, Card, Modal } from 'react-daisyui';
import { useTimeout, useToggle } from 'usehooks-ts';
import { X } from 'lucide-react';
import { useTempSensorsQuery } from '@/hooks/influxdb';
import { TemperatureSensorChart } from '@/ui/charts/TemperatureSensorChart';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import clsx from 'clsx';
import { useState } from 'react';
import Color from 'color';
import useIdle from '@/hooks/useIdle';

const sensorIdToName = (sensorId: string | null) => {
  switch (sensorId) {
    case 'D9353438450D':
      return 'Backyard';
    case 'D4343037362D':
      return 'Patio';
    case 'C76A0246647E':
      return 'Car';
    case 'D7353530665A':
      return 'Living Room';
    default:
      return 'Unknown';
  }
};

const tempToColor = (temp: number) => {
  const subZeroTemp = -20;
  const iceTemp = 0;
  const coldTemp = 8;
  const coolTemp = 15;
  const comfortableTemp = 23;
  const hotTemp = 30;

  const s = 45;
  const v = 55;
  const subZeroColor = new Color({ h: 240, s: 0, v: 0 });
  const iceColor = new Color({ h: 240, s: 0, v });
  const coldColor = new Color({ h: 240, s, v });
  const coolColor = new Color({ h: 180, s, v });
  const comfortableColor = new Color({ h: 120, s, v });
  const hotColor = new Color({ h: 0, s, v });

  if (temp < subZeroTemp) {
    return subZeroColor;
  } else if (temp < iceTemp) {
    return subZeroColor.mix(
      iceColor,
      (temp - subZeroTemp) / (iceTemp - subZeroTemp),
    );
  } else if (temp < coldTemp) {
    return iceColor.mix(coldColor, (temp - iceTemp) / (coldTemp - iceTemp));
  } else if (temp < coolTemp) {
    return coldColor.mix(coolColor, (temp - coldTemp) / (coolTemp - coldTemp));
  } else if (temp < comfortableTemp) {
    return coolColor.mix(
      comfortableColor,
      (temp - coolTemp) / (comfortableTemp - coolTemp),
    );
  } else if (temp < hotTemp) {
    return comfortableColor.mix(
      hotColor,
      (temp - comfortableTemp) / (hotTemp - comfortableTemp),
    );
  }

  return hotColor;
};

const sensorOffline = (
  lastSeen: Date | undefined,
  threshold = 15 * 60 * 1000, // 15 minutes
) => {
  if (!lastSeen) {
    return true;
  }

  return new Date(lastSeen).getTime() < Date.now() - threshold;
};

export const SensorsCard = () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [detailsModalOpen, toggleDetailsModal, setDetailsModalOpen] =
    useToggle(false);
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null);

  const isIdle = useIdle();
  const tempSensors = useTempSensorsQuery();

  const tempData = tempSensors
    ?.filter((row) => row.device_id === activeSensorId)
    .map((row) => ({
      time: new Date(row._time),
      temp: row._value,
      fill: tempToColor(row._value).toString(),
    }));

  const sensorIds = [
    'D9353438450D',
    'D4343037362D',
    'D7353530665A',
    'C76A0246647E',
  ];

  useTimeout(
    () => {
      setDetailsModalOpen(false);
    },
    detailsModalOpen && isIdle ? 10 * 1000 : null,
  );

  return (
    <>
      <Card
        compact
        className="col-span-2 flex-row gap-3 justify-around bg-base-300 overflow-x-auto overflow-y-hidden min-h-16 px-3"
      >
        {sensorIds.map((sensorId) => {
          const sensor = tempSensors?.findLast(
            (row) => row.device_id === sensorId,
          );

          const offline = sensorOffline(sensor?._time);

          return (
            <Button
              key={sensorId}
              color="ghost"
              className="h-full px-0"
              onClick={() => {
                setActiveSensorId(sensorId);
                setDetailsModalOpen(true);
              }}
            >
              <div
                className={clsx(
                  'flex items-center gap-1 stat-title',
                  offline && 'text-stone-500',
                )}
              >
                {sensor === undefined ? null : (
                  <Badge
                    size="xs"
                    className="text-stone-500"
                    style={
                      offline
                        ? {}
                        : {
                            backgroundColor: tempToColor(
                              sensor._value,
                            ).toString(),
                          }
                    }
                  />
                )}
                {sensorIdToName(sensorId)}
                {sensor === undefined ? null : (
                  <>: {Math.round(sensor._value)} °C</>
                )}
              </div>
            </Button>
          );
        })}
      </Card>
      <Modal.Legacy
        open={detailsModalOpen}
        onClickBackdrop={toggleDetailsModal}
        responsive
        className="pt-0"
      >
        <Modal.Header className="sticky w-auto top-0 p-6 m-0 -mx-6 bg-base-100 bg-opacity-75 backdrop-blur-sm z-0">
          <div className="flex items-center justify-between font-bold">
            <div className="mx-4 text-center">
              {sensorIdToName(activeSensorId)} temperature
              {sensorOffline(tempData[tempData.length - 1]?.time) ? (
                <span className="pl-2 text-stone-500">(offline)</span>
              ) : (
                <span className="pl-2">
                  {Math.round(tempData[tempData.length - 1]?.temp)} °C
                </span>
              )}
            </div>
            <Button onClick={toggleDetailsModal} variant="outline">
              <X />
            </Button>
          </div>
        </Modal.Header>
        <Modal.Body className="flex flex-col gap-3 -mt-4 z-10">
          {tempData.length > 0 ? (
            <ResponsiveChart
              height={350}
              className="rounded-lg"
            >
              {({ width, height }) => (
                <TemperatureSensorChart
                  data={tempData}
                  width={width}
                  height={height}
                  animate={true}
                />
              )}
            </ResponsiveChart>
          ) : (
            <div className="p-8 text-stone-500 text-center">
              <div className="text-4xl mb-2">📡</div>
              <div>Sensor offline</div>
              <div className="text-sm mt-1 text-stone-600">
                No data available
              </div>
            </div>
          )}
        </Modal.Body>
      </Modal.Legacy>
    </>
  );
};
