import { Button, Card, Modal } from 'react-daisyui';
import { useToggle } from 'usehooks-ts';
import { X } from 'lucide-react';
import { useTempSensorsQuery } from '@/hooks/influxdb';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  ResponsiveContainer,
} from 'recharts';
import clsx from 'clsx';
import { useState } from 'react';

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

export const SensorsCard = () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [detailsModalOpen, toggleDetailsModal, setDetailsModalOpen] =
    useToggle(false);
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null);

  const tempSensors = useTempSensorsQuery();

  const latestBackyardTemp = tempSensors?.findLast(
    (row) => row.device_id === 'D9353438450D',
  );

  // const latestFrontyardTemp = tempSensors?.findLast(
  //   (row) => row.device_id === 'D83534387029',
  // )?._value;

  const latestPatioTemp = tempSensors?.findLast(
    (row) => row.device_id === 'D4343037362D',
  );

  const latestLivingRoomTemp = tempSensors?.findLast(
    (row) => row.device_id === 'D7353530665A',
  );

  const latestCarTemp = tempSensors?.findLast(
    (row) => row.device_id === 'C76A0246647E',
  );

  const tempData = tempSensors
    ?.filter((row) => row.device_id === activeSensorId)
    .map((row) => ({
      time: new Date(row._time),
      temp: row._value,
    }));

  return (
    <>
      <Card
        compact
        className="col-span-2 flex-row justify-around bg-base-300 overflow-x-auto overflow-y-hidden min-h-16"
      >
        <Button
          color="ghost"
          className="h-full px-0"
          onClick={() => {
            setActiveSensorId('D9353438450D');
            setDetailsModalOpen(true);
          }}
        >
          <Card.Body>
            <div
              className={clsx(
                'stat-title',
                (latestBackyardTemp?._time ?? 0) <
                  new Date(Date.now() - 15 * 60 * 1000)
                  ? 'text-stone-500'
                  : '',
              )}
            >
              Backyard: {latestBackyardTemp?._value.toFixed(1)} °C
            </div>
          </Card.Body>
        </Button>
        <Button
          color="ghost"
          className="h-full px-0"
          onClick={() => {
            setActiveSensorId('D4343037362D');
            setDetailsModalOpen(true);
          }}
        >
          <Card.Body>
            <div
              className={clsx(
                'stat-title',
                (latestPatioTemp?._time ?? 0) <
                  new Date(Date.now() - 15 * 60 * 1000)
                  ? 'text-stone-500'
                  : '',
              )}
            >
              Patio: {latestPatioTemp?._value.toFixed(1)} °C
            </div>
          </Card.Body>
        </Button>
        <Button
          color="ghost"
          className="h-full px-0"
          onClick={() => {
            setActiveSensorId('C76A0246647E');
            setDetailsModalOpen(true);
          }}
        >
          <Card.Body>
            <div
              className={clsx(
                'stat-title',
                (latestCarTemp?._time ?? 0) <
                  new Date(Date.now() - 15 * 60 * 1000)
                  ? 'text-stone-500'
                  : '',
              )}
            >
              Car: {latestCarTemp?._value.toFixed(1)} °C
            </div>
          </Card.Body>
        </Button>
        <Button
          color="ghost"
          className="h-full px-0"
          onClick={() => {
            setActiveSensorId('D7353530665A');
            setDetailsModalOpen(true);
          }}
        >
          <Card.Body>
            <div
              className={clsx(
                'stat-title',
                (latestLivingRoomTemp?._time ?? 0) <
                  new Date(Date.now() - 15 * 60 * 1000)
                  ? 'text-stone-500'
                  : '',
              )}
            >
              Indoors: {latestLivingRoomTemp?._value.toFixed(1)} °C
            </div>
          </Card.Body>
        </Button>
      </Card>
      <Modal.Legacy
        open={detailsModalOpen}
        onClickBackdrop={toggleDetailsModal}
        responsive
        className="pt-0"
      >
        <Modal.Header className="sticky w-auto top-0 p-6 m-0 -mx-6 bg-base-100 bg-opacity-75 backdrop-blur z-0">
          <div className="flex items-center justify-between font-bold">
            <div className="mx-4 text-center">
              {sensorIdToName(activeSensorId)} temperature
            </div>
            <Button onClick={toggleDetailsModal} variant="outline">
              <X />
            </Button>
          </div>
        </Modal.Header>
        <Modal.Body className="flex flex-col gap-3 -mt-4 z-10">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart
              width={500}
              height={300}
              data={tempData}
              margin={{
                top: 20,
                right: 50,
                left: 0,
                bottom: 0,
              }}
            >
              <defs>
                <linearGradient
                  id="colorTemp"
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} />
                  {/* <stop offset="0%" stopColor="blue" /> */}
                  {/* <stop offset={cold} stopColor="blue" /> */}
                  {/* <stop offset={comfortable} stopColor="green" /> */}
                  {/* <stop offset={hot} stopColor="red" /> */}
                  {/* <stop offset="100%" stopColor="red" /> */}
                  <stop offset="100%" stopColor="#82ca9d" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                scale="time"
                interval="equidistantPreserveStart"
                tickFormatter={(date) =>
                  new Date(date).toLocaleTimeString('en-FI', {
                    second: undefined,
                    timeStyle: 'short',
                  })
                }
                tickMargin={8}
              />
              <YAxis tickMargin={8} domain={['auto', 'auto']} />
              <Area
                type="step"
                dataKey="temp"
                stroke="rgba(40, 40, 40, 0.5)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorTemp)"
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Modal.Body>
      </Modal.Legacy>
    </>
  );
};
