import {
  Check,
  Edit,
  ChevronLeft,
  Expand,
  Plus,
  Search,
  Settings2,
  Shrink,
} from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useCallback } from 'react';
import { Link, useLocation, useNavigate, useMatch } from 'react-router-dom';
import { useGroupsState } from '@/hooks/websocket';
import { useIsFullscreen } from '@/hooks/isFullscreen';
import useIdle from '@/hooks/useIdle';
import { commandPaletteOpenAtom } from '@/ui/CommandPalette';
import { AssistantButton } from '@/assistant/AssistantButton';
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
      <AssistantButton
        variant="ghost"
        size="icon"
        iconOnly
        label="Ask AI"
        title="Ask AI"
      />
      <CommandPaletteTrigger />
      {pathname === '/map' && (
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

/**
 * Search affordance for the command palette. A full search field on desktop
 * (the primary accelerator is Ctrl+K / Ctrl+P) and an icon button on mobile.
 */
export const CommandPaletteTrigger = () => {
  const openPalette = useSetAtom(commandPaletteOpenAtom);

  return (
    <>
      <button
        type="button"
        onClick={() => openPalette(true)}
        aria-label="Open command palette"
        className="hidden items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/70 hover:text-foreground sm:flex"
      >
        <Search className="size-4" />
        <span>Search…</span>
        <span className="ml-2 flex items-center gap-1 text-[0.65rem]">
          <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-sans">
            Ctrl
          </kbd>
          <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-sans">
            K
          </kbd>
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open command palette"
        className="sm:hidden"
        onClick={() => openPalette(true)}
      >
        <Search />
      </Button>
    </>
  );
};
