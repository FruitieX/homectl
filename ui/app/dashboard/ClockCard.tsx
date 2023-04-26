import { useEffect, useState } from 'react';
import { Card } from 'react-daisyui';
import { useInterval } from 'usehooks-ts';

export const ClockCard = () => {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
  }, []);
  useInterval(async () => {
    setTime(new Date());
  }, 1000);

  return (
    <Card compact className="col-span-1">
      <Card.Body className="flex items-center justify-center shadow-lg">
        <span className="text-6xl">
          {time !== null && (
            <>
              {time.getHours().toString().padStart(2, '0')}:
              {time.getMinutes().toString().padStart(2, '0')}
            </>
          )}
        </span>
      </Card.Body>
    </Card>
  );
};
