import { Badge, Button, Card, Modal } from 'react-daisyui';
import { useTimeout, useToggle } from 'usehooks-ts';
import { X } from 'lucide-react';
import { useTempSensorsQuery } from '@/hooks/influxdb';
import { TemperatureSensorChart } from '@/ui/charts/TemperatureSensorChart';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import clsx from 'clsx';
import { useState, useMemo } from 'react';
import useIdle from '@/hooks/useIdle';
import { getTemperatureColor } from '@/ui/charts/TemperatureSensorChart';

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

  // Memoize the temperature data transformation to prevent unnecessary re-renders
  const tempData = useMemo(() => {
    if (!tempSensors || !activeSensorId) return [];

    return tempSensors
      .filter((row) => row.device_id === activeSensorId)
      .map((row) => ({
        time: new Date(row._time),
        temp: row._value,
        fill: getTemperatureColor(row._value),
      }));
  }, [tempSensors, activeSensorId]);

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
                            backgroundColor: getTemperatureColor(sensor._value),
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
                  {tempData[tempData.length - 1]?.temp.toFixed(1)} °C
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
            <ResponsiveChart height={350} className="rounded-lg">
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
