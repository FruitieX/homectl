import { useSelectedDevices } from '@/hooks/selectedDevices';
import {
  X,
  Edit,
  ChevronLeft,
  Save,
  Expand,
  Shrink,
  Radio,
  WifiOff,
} from 'lucide-react';
import { useCallback } from 'react';
import { useDeviceModalState } from '@/hooks/deviceModalState';
import { useLocation, useNavigate, useMatch } from 'react-router-dom';
import { useConnectionStatus, useGroupsState } from '@/hooks/websocket';
import { useSaveSceneModalState } from '@/hooks/saveSceneModalState';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import useIdle from '@/hooks/useIdle';
import { Button } from '@/ui/primitives/button';

export const Navbar = () => {
  const navigate = useNavigate();

  const pathname = useLocation().pathname;
  const groups = useGroupsState();
  const groupMatch = useMatch('/groups/:id');

  let title = 'homectl';
  let back: string | null = null;

  if (pathname === '/' || pathname === '/dashboard') {
    title = 'Home';
  } else if (pathname === '/map') {
    title = 'Floorplan';
  } else if (pathname === '/groups') {
    title = 'Rooms';
  } else if (pathname === '/settings') {
    title = 'Settings';
  } else if (pathname?.startsWith('/groups/')) {
    const groupId = groupMatch?.params.id ?? '';
    const group = (groups ?? {})[groupId];
    const groupName = group?.name ?? '...';

    title = groupName;
    back = '/groups';
  } else if (pathname?.startsWith('/config')) {
    title = 'Settings';
  }

  const [selectedDevices, setSelectedDevices] = useSelectedDevices();
  const {
    setState: setDeviceModalState,
    setOpen: setDeviceModalOpen,
    setPresentation: setDeviceModalPresentation,
  } = useDeviceModalState();

  const { setOpen: setSaveSceneModalOpen } = useSaveSceneModalState();

  const clearSelectedDevices = useCallback(() => {
    setSelectedDevices([]);
  }, [setSelectedDevices]);

  const editSelectedDevices = useCallback(() => {
    setDeviceModalState(selectedDevices);
    setDeviceModalPresentation('dialog');
    setDeviceModalOpen(true);
  }, [
    selectedDevices,
    setDeviceModalOpen,
    setDeviceModalState,
    setDeviceModalPresentation,
  ]);

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
  const connectionStatus = useConnectionStatus();
  const connected = connectionStatus === 'connected';

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
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-1 border-b border-border/40 bg-background px-3 pt-[env(safe-area-inset-top)]  sm:px-5 lg:h-16 lg:px-8">
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
        <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
          <h1 className="truncate text-xl font-semibold text-foreground">
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
      <div
        className="mr-1 hidden items-center gap-2 rounded-full border border-border/55 bg-card/55 px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm sm:flex"
        role="status"
      >
        {connected ? (
          <Radio className="size-3.5 text-emerald-500" />
        ) : (
          <WifiOff className="size-3.5 text-amber-500" />
        )}
        <span>{connected ? 'Live' : 'Reconnecting'}</span>
      </div>
      {title === 'Home' && (
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
