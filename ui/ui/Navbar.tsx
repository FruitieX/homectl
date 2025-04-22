import { useSelectedDevices } from '@/hooks/selectedDevices';
import { Button } from 'react-daisyui';
import { X, Edit, ChevronLeft, Save, Expand, Shrink } from 'lucide-react';
import { useCallback } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { usePathname, useRouter } from 'next/navigation';
import { useWebsocketState } from '@/hooks/websocket';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import useIdle from '@/hooks/useIdle';

export const Navbar = () => {
  const router = useRouter();

  const pathname = usePathname();
  const state = useWebsocketState();

  let title = 'homectl';
  let back: string | null = null;

  if (pathname === '/' || pathname === '/dashboard') {
    title = 'Dashboard';
  } else if (pathname === '/map') {
    title = 'Floorplan';
  } else if (pathname === '/groups') {
    title = 'Groups';
  } else if (pathname?.startsWith('/groups/')) {
    const groupId = pathname.split('/')[2];
    const group = (state?.groups ?? {})[groupId];
    const groupName = group?.name ?? '...';

    title = `Scenes for ${groupName}`;
    back = '/groups';
  }

  const [selectedDevices, setSelectedDevices] = useSelectedDevices();
  const { setState: setDeviceModalState, setOpen: setDeviceModalOpen } =
    useDeviceModalState();

  const { setOpen: setSaveSceneModalOpen } = useSaveSceneModalState();

  const clearSelectedDevices = useCallback(() => {
    setSelectedDevices([]);
  }, [setSelectedDevices]);

  const editSelectedDevices = useCallback(() => {
    setDeviceModalState(selectedDevices);
    setDeviceModalOpen(true);
  }, [selectedDevices, setDeviceModalOpen, setDeviceModalState]);

  const saveScene = useCallback(() => {
    setSaveSceneModalOpen(true);
  }, [setSaveSceneModalOpen]);

  const navigateBack = useCallback(() => {
    if (back) {
      router.replace(back);
    }
  }, [back, router]);

  const [isFullscreen, setIsFullscreen] = useIsFullscreen();

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement === undefined) {
      // iOS Safari fix
      if (isFullscreen) {
        setIsFullscreen(false);
      } else {
        setIsFullscreen(true);
      }
    } else if (document.fullscreenElement !== null) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    }
  }, [isFullscreen, setIsFullscreen]);

  const isIdle = useIdle();

  if (isFullscreen) {
    return (
      <>
        <div className="h-2" />
        {!isIdle && (
          <Button
            className="absolute top-2 right-0 z-10 opacity-20"
            color="ghost"
            startIcon={isFullscreen ? <Shrink /> : <Expand />}
            onClick={toggleFullscreen}
          />
        )}
      </>
    );
  }

  return (
    <div className="navbar z-10 bg-base-100 bg-opacity-75 backdrop-blur">
      {back !== null && (
        <Button
          color="ghost"
          startIcon={<ChevronLeft />}
          onClick={navigateBack}
        />
      )}
      {selectedDevices.length === 0 || title !== 'Floorplan' ? (
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
          <Button color="ghost" startIcon={<Save />} onClick={saveScene} />
          <Button
            color="ghost"
            startIcon={<Edit />}
            onClick={editSelectedDevices}
          />
        </>
      )}
      {title === 'Dashboard' && (
        <>
          <div className="flex-1" />
          <Button
            color="ghost"
            startIcon={isFullscreen ? <Shrink /> : <Expand />}
            onClick={toggleFullscreen}
          />
        </>
      )}
    </div>
  );
};
