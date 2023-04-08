import { Bot, Car, LampCeiling } from 'lucide-react';
import { Button, Card } from 'react-daisyui';

export const ControlsCard = () => {
  const lampActive = true;
  const vaccuumActive = true;
  const carActive = false;

  return (
    <Card compact className="col-span-2">
      <Card.Body className="flex-row items-center justify-center overflow-x-auto shadow-lg">
        <Button
          color="ghost"
          className={lampActive ? '' : 'text-zinc-700'}
          size="lg"
          startIcon={<LampCeiling size="3rem" />}
        />
        <Button
          color="ghost"
          className={vaccuumActive ? '' : 'text-zinc-700'}
          size="lg"
          startIcon={<Bot size="3rem" />}
        />
        <Button
          color="ghost"
          className={carActive ? '' : 'text-zinc-700'}
          size="lg"
          startIcon={<Car size="3rem" />}
        />
      </Card.Body>
    </Card>
  );
};
