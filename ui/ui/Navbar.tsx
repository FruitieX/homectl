import { useSelectedDevices } from '@/hooks/selectedDevices';
import { X, Edit, ChevronLeft, Save, Expand, Shrink } from 'lucide-react';
import { useCallback } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGroupsState } from '@/hooks/websocket';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import useIdle from '@/hooks/useIdle';
import { Button } from '@/ui/primitives/button';

export const Navbar = () => {
  const navigate = useNavigate();

  const pathname = useLocation().pathname;
  const groups = useGroupsState();

  let title = 'homectl';
  let back: string | null = null;

  if (pathname === '/' || pathname === '/dashboard') {
    title = 'Dashboard';
  } else if (pathname === '/map') {
    title = 'Floorplan';
  } else if (pathname === '/groups') {
    title = 'Groups';
  } else if (pathname === '/settings') {
    title = 'Settings';
  } else if (pathname?.startsWith('/groups/')) {
    const groupId = pathname.split('/')[2];
    const group = (groups ?? {})[groupId];
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
      navigate(back, { replace: true });
    }
  }, [back, navigate]);

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
    return isIdle ? null : (
      <Button
        className="absolute right-2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 opacity-30 backdrop-blur"
        variant="ghost"
        size="icon"
        onClick={toggleFullscreen}
      >
        {isFullscreen ? <Shrink /> : <Expand />}
      </Button>
    );
  }

  return (
    <header className="z-10 flex h-14 shrink-0 items-center gap-1 border-b border-border/50 bg-background/80 px-2 pt-[env(safe-area-inset-top)] shadow-sm backdrop-blur-xl supports-backdrop-filter:bg-background/70">
      {back !== null && (
        <Button
          aria-label="Go back"
          variant="ghost"
          size="icon"
          onClick={navigateBack}
        >
          <ChevronLeft />
        </Button>
      )}
      {selectedDevices.length === 0 || title !== 'Floorplan' ? (
        <div className="flex min-w-0 flex-1 items-center px-2">
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h1>
        </div>
      ) : (
        <>
          <Button
            aria-label="Clear selected devices"
            variant="ghost"
            size="icon"
            onClick={clearSelectedDevices}
          >
            <X />
          </Button>
          <div className="flex min-w-0 flex-1 items-center px-2">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {selectedDevices.length}{' '}
              {selectedDevices.length === 1 ? 'device' : 'devices'}
            </h1>
          </div>
          <Button
            aria-label="Save selected devices as scene"
            variant="ghost"
            size="icon"
            onClick={saveScene}
          >
            <Save />
          </Button>
          <Button
            aria-label="Edit selected devices"
            variant="ghost"
            size="icon"
            onClick={editSelectedDevices}
          >
            <Edit />
          </Button>
        </>
      )}
      {title === 'Dashboard' && (
        <>
          <Button
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Shrink /> : <Expand />}
          </Button>
        </>
      )}
    </header>
  );
};
