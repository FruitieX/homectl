import {
  Check,
  Edit,
  ChevronLeft,
  Expand,
  Plus,
  Settings2,
  Shrink,
} from 'lucide-react';
import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { Link, useLocation, useNavigate, useMatch } from 'react-router-dom';
import { useGroupsState } from '@/hooks/websocket';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import useIdle from '@/hooks/useIdle';
import { AssistantButton } from '@/assistant/AssistantButton';
import { assistantPageContextAtom } from '@/assistant/state';
import { Button } from '@/ui/primitives/button';

export const Navbar = () => {
  const navigate = useNavigate();

  const location = useLocation();
  const pathname = location.pathname;
  const isDashboardEditing =
    (pathname === '/' || pathname === '/dashboard') &&
    new URLSearchParams(location.search).get('edit') === '1';
  const groups = useGroupsState();
  const groupMatch = useMatch('/groups/:id');

  let title = 'homectl';
  let back: string | null = null;
  // Settings pages render their own page heading, so the shell must not add a
  // second <h1> for the same screen.
  let pageOwnsHeading = false;

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
    pageOwnsHeading = true;
  }

  const navigateBack = useCallback(() => {
    if (back) {
      navigate(back, { replace: true });
    }
  }, [back, navigate]);

  const [isFullscreen, setIsFullscreen] = useIsFullscreen();
  const assistantContext = useAtomValue(assistantPageContextAtom);

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
        {pageOwnsHeading ? (
          <p className="truncate text-xl font-semibold text-foreground">
            {title}
          </p>
        ) : (
          <h1 className="truncate text-xl font-semibold text-foreground">
            {title}
          </h1>
        )}
      </div>
      {(pathname === '/map' || pathname?.startsWith('/groups/')) && (
        <div id="floorplan-tabs" className="flex min-w-0 items-center gap-1" />
      )}
      <AssistantButton
        variant="ghost"
        size="icon"
        iconOnly
        label="Ask AI"
        title={
          assistantContext
            ? `Ask AI about ${assistantContext.label ?? assistantContext.id ?? assistantContext.kind}`
            : 'Ask AI'
        }
        attachment={assistantContext ?? undefined}
      />
      {(pathname === '/map' || pathname?.startsWith('/groups/')) && (
        <div
          id="floorplan-toolbar"
          className="flex min-w-0 items-center gap-1"
        />
      )}
      {title === 'Home' && (
        <>
          <Button asChild variant="ghost" size="icon">
            <Link
              to={
                isDashboardEditing
                  ? { pathname, search: '' }
                  : { pathname, search: '?edit=1' }
              }
              aria-label={
                isDashboardEditing ? 'Done editing dashboard' : 'Edit dashboard'
              }
            >
              {isDashboardEditing ? <Check /> : <Edit />}
            </Link>
          </Button>
          {isDashboardEditing ? (
            <>
              <Button asChild variant="ghost" size="icon">
                <Link
                  to={{ pathname, search: '?edit=1&add-widget=1' }}
                  aria-label="Add dashboard widget"
                >
                  <Plus />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="icon">
                <Link
                  to={{ pathname, search: '?edit=1&settings=1' }}
                  aria-label="Dashboard editing settings"
                >
                  <Settings2 />
                </Link>
              </Button>
            </>
          ) : null}
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
