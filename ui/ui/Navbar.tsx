import { Edit, ChevronLeft, Expand, Shrink } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useLocation, useNavigate, useMatch } from 'react-router-dom';
import { useGroupsState } from '@/hooks/websocket';
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
        aria-label="Exit fullscreen"
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
      <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
        <h1 className="truncate text-xl font-semibold text-foreground">
          {title}
        </h1>
      </div>
      {pathname === '/map' && (
        <div
          id="floorplan-toolbar"
          className="flex min-w-0 items-center gap-1"
        />
      )}
      {title === 'Home' && (
        <>
          <Button asChild variant="ghost" size="icon">
            <Link to="/config/dashboard" aria-label="Edit dashboard">
              <Edit />
            </Link>
          </Button>
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
