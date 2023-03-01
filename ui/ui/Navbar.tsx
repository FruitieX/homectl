import { useSelectedDevices } from '@/hooks/selectedDevices';
import { Button } from 'react-daisyui';
import { X, Edit } from 'lucide-react';
import { useCallback } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { usePathname } from 'next/navigation';

export const Navbar = () => {
  const pathname = usePathname();

  let title = 'homectl';
  switch (pathname) {
    case '/': {
      title = 'Dashboard';
      break;
    }
    case '/map': {
      title = 'Map';
      break;
    }
    case '/groups': {
      title = 'Groups';
      break;
    }
  }

  const [selectedDevices, setSelectedDevices] = useSelectedDevices();
  const { setState: setDeviceModalState, setOpen: setDeviceModalOpen } =
    useDeviceModalState();

  const clearSelectedDevices = useCallback(() => {
    setSelectedDevices([]);
  }, [setSelectedDevices]);

  const editSelectedDevices = useCallback(() => {
    setDeviceModalState(selectedDevices);
    setDeviceModalOpen(true);
  }, [selectedDevices, setDeviceModalOpen, setDeviceModalState]);

  return (
    <div className="navbar z-10 bg-base-100 bg-opacity-75 backdrop-blur">
      {selectedDevices.length === 0 ? (
        <a className="btn-ghost btn text-xl normal-case">{title}</a>
      ) : (
        <>
          <Button
            color="ghost"
            startIcon={<X />}
            onClick={clearSelectedDevices}
          />
          <a className="btn-ghost btn text-xl normal-case">
            {selectedDevices.length}{' '}
            {selectedDevices.length === 1 ? 'device' : 'devices'}
          </a>
          <div className="flex-1" />
          <Button
            color="ghost"
            startIcon={<Edit />}
            onClick={editSelectedDevices}
          />
        </>
      )}
    </div>
  );
};
