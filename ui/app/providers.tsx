import { HomectlLogo } from '@/ui/HomectlLogo';
import { Provider as JotaiProvider } from 'jotai';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  useConnectionStatus,
  useProvideWebsocketState,
} from '@/hooks/websocket';
import '@/styles/globals.css';
import {
  HomectlBottomNavigation,
  HomectlNavigationRail,
} from '@/ui/BottomNavigation';
import { Navbar } from '@/ui/Navbar';
import { useProvideAppConfig } from '@/hooks/appConfig';
import { useApplyTheme } from '@/hooks/theme';
import { useApplyBackdropBlurEffects } from '@/hooks/visualEffects';
import { createHomectlQueryClient } from '@/lib/query-client';
import { Toaster } from '@/ui/primitives/toaster';
import { TooltipProvider } from '@/ui/primitives/tooltip';
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/ui/primitives/button';
import { RefreshCw, ServerOff, WifiOff } from 'lucide-react';

const ColorPickerModal = lazy(() =>
  import('@/ui/ColorPickerModal').then(({ ColorPickerModal }) => ({
    default: ColorPickerModal,
  })),
);
const SaveSceneModal = lazy(() =>
  import('@/ui/SaveSceneModal').then(({ SaveSceneModal }) => ({
    default: SaveSceneModal,
  })),
);
const SceneModal = lazy(() =>
  import('@/ui/SceneModal').then(({ SceneModal }) => ({
    default: SceneModal,
  })),
);
const CarHeaterModal = lazy(() =>
  import('./dashboard/CarHeaterModal').then(({ CarHeaterModal }) => ({
    default: CarHeaterModal,
  })),
);

export const Providers = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(() => createHomectlQueryClient());

  return (
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster richColors position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </JotaiProvider>
  );
};

export const ProvideAppConfig = ({ children }: { children: ReactNode }) => {
  const { loaded, error, retry } = useProvideAppConfig();
  if (!loaded) {
    return (
      <div className="app-ambient relative grid min-h-dvh flex-1 place-items-center overflow-hidden bg-background p-6 text-foreground">
        <div className="relative z-10 w-full max-w-md rounded-[2rem] border border-border/60 bg-card/70 p-7 shadow-2xl backdrop-blur-2xl sm:p-9">
          <div className="mb-8 flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl text-foreground">
              <HomectlLogo className="size-8" />
            </div>
            <div>
              <div className="font-semibold tracking-[-0.03em]">homectl</div>
              <div className="text-xs text-muted-foreground">
                Home automation
              </div>
            </div>
          </div>
          {error ? (
            <div className="space-y-5">
              <div className="grid size-12 place-items-center rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-300">
                <ServerOff />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.045em]">
                  Cannot connect to homectl
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The interface could not contact the homectl server. Your
                  automations may still be running locally.
                </p>
                <p className="mt-3 rounded-xl bg-muted/55 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {error}
                </p>
              </div>
              <Button onClick={retry} className="w-full">
                <RefreshCw />
                Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="relative flex size-3">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40" />
                  <span className="relative inline-flex size-3 rounded-full bg-primary" />
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  Connecting…
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return children;
};

export const Layout = ({ children }: { children: ReactNode }) => {
  useProvideWebsocketState();
  const connectionStatus = useConnectionStatus();
  useApplyTheme();
  useApplyBackdropBlurEffects();

  // Reload app at 4am
  useEffect(() => {
    const now = new Date();
    const reloadAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      4,
      0,
      0,
    );
    reloadAt.setDate(reloadAt.getDate() + 1);

    const reloadTimeout = setTimeout(() => {
      window.location.reload();
    }, reloadAt.getTime() - now.getTime());

    return () => {
      clearTimeout(reloadTimeout);
    };
  });

  return (
    <div className="app-ambient relative flex min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <HomectlNavigationRail />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <Navbar />
        {connectionStatus !== 'connected' ? (
          <div
            className="relative z-20 flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[0.7rem] font-semibold text-amber-800 dark:text-amber-200 sm:hidden"
            role="status"
          >
            <WifiOff className="size-3.5" />
            Live controls are reconnecting
          </div>
        ) : null}
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
        <HomectlBottomNavigation />
      </div>
      <Suspense fallback={null}>
        <ColorPickerModal />
        <SaveSceneModal />
        <SceneModal />
        <CarHeaterModal />
      </Suspense>
    </div>
  );
};
