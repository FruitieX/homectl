import { SettingsBreadcrumbs } from '@/ui/settings/SettingsNavigation';
import { Check, Edit, Expand, Plus, Settings2, Shrink } from 'lucide-react';
import { useAtomValue } from 'jotai';
import { Link, useLocation, useMatch } from 'react-router-dom';
import { useFullscreenControls } from '@/hooks/isFullscreen';
import useIdle from '@/hooks/useIdle';
import { AssistantButton } from '@/assistant/AssistantButton';
import { assistantPageContextAtom } from '@/assistant/state';
import { Button } from '@/ui/primitives/button';
import { configSectionAliases, configSections } from '../app/config/sections';

export const Navbar = () => {
  const location = useLocation();
  const pathname = location.pathname;
  const isDashboardEditing =
    (pathname === '/' || pathname === '/dashboard') &&
    new URLSearchParams(location.search).get('edit') === '1';
  const groupMatch = useMatch('/groups/:id');
  const isRoom = Boolean(groupMatch);
  const isRoomMap =
    isRoom && new URLSearchParams(location.search).get('view') === 'floorplan';

  let title = 'homectl';
  // Named at sm and up; a phone shows one location signal at a time.
  let sectionSuffix: string | null = null;
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
    title = 'Rooms & groups';
  } else if (pathname?.startsWith('/config')) {
    // Name the section you are in, so the app bar answers "where am I?" even on
    // a detail page opened from a link.
    const resolved = configSectionAliases[pathname] ?? pathname;
    const section =
      configSections.find((entry) => entry.href === resolved) ??
      configSections.find((entry) => resolved.startsWith(`${entry.href}/`));
    // Phones get one location signal: the list page's own title, and Back plus
    // the item title on a detail page. Naming the section in the app bar as
    // well is repetition on a narrow screen, so it only appears from sm up.
    title = 'Settings';
    sectionSuffix = section?.label ?? null;
    pageOwnsHeading = true;
  }

  const {
    enabled: isFullscreen,
    toggle: toggleFullscreen,
    restore,
    restoreNeeded,
    error: fullscreenError,
  } = useFullscreenControls();
  const assistantContext = useAtomValue(assistantPageContextAtom);

  const isIdle = useIdle();

  if (isFullscreen) {
    return isIdle ? null : (
      <div className="absolute right-2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-30 flex items-center gap-2">
        {restoreNeeded && (
          <Button variant="outline" size="sm" onClick={() => void restore()}>
            <Expand className="size-4" />
            Restore fullscreen
          </Button>
        )}
        {fullscreenError && (
          <span role="alert" className="text-xs text-destructive">
            {fullscreenError}
          </span>
        )}
        <Button
          aria-label="Exit fullscreen"
          className="opacity-60 backdrop-blur"
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
        >
          <Shrink />
        </Button>
      </div>
    );
  }

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-1 border-b border-border/40 bg-background px-3 pt-[env(safe-area-inset-top)] sm:px-5 lg:px-8">
      <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-1">
        {isRoom ? (
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground"
          >
            <Link
              to="/groups"
              className={
                isRoomMap
                  ? 'hidden hover:text-foreground sm:inline'
                  : 'hover:text-foreground'
              }
            >
              Rooms &amp; groups
            </Link>
            {isRoomMap && (
              <>
                <span aria-hidden="true" className="hidden sm:inline">
                  /
                </span>
                <Link
                  to={`/groups/${encodeURIComponent(groupMatch!.params.id!)}`}
                  className="min-w-0 truncate hover:text-foreground"
                >
                  Room controls
                </Link>
                <span aria-hidden="true" className="hidden sm:inline">
                  /
                </span>
                <span className="hidden sm:inline">Floorplan</span>
              </>
            )}
          </nav>
        ) : pageOwnsHeading ? (
          <SettingsBreadcrumbs />
        ) : (
          <h1 className="truncate text-xl font-semibold text-foreground">
            {title}
            {sectionSuffix ? (
              <span className="hidden sm:inline"> · {sectionSuffix}</span>
            ) : null}
          </h1>
        )}
      </div>
      {(pathname === '/map' || isRoomMap) && (
        <div
          id="floorplan-tabs"
          className="flex min-w-0 max-w-[40%] items-center gap-1 empty:hidden"
        />
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
      {(pathname === '/map' || isRoomMap) && (
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
