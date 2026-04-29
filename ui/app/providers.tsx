import { Provider as JotaiProvider } from 'jotai';
import { QueryClientProvider } from '@tanstack/react-query';
import { useProvideWebsocketState } from '@/hooks/websocket';
import '@/styles/globals.css';
import { HomectlBottomNavigation } from '@/ui/BottomNavigation';
import { Navbar } from '@/ui/Navbar';
import { useProvideAppConfig } from '@/hooks/appConfig';
import { useApplyTheme } from '@/hooks/theme';
import { useApplyBackdropBlurEffects } from '@/hooks/visualEffects';
import { createHomectlQueryClient } from '@/lib/query-client';
import { Toaster } from '@/ui/primitives/toaster';
import { TooltipProvider } from '@/ui/primitives/tooltip';
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react';

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
  const appConfigLoaded = useProvideAppConfig();
  if (!appConfigLoaded) return null;

  return children;
};

export const Layout = ({ children }: { children: ReactNode }) => {
  useProvideWebsocketState();
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
    <>
      <Navbar />
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
      <HomectlBottomNavigation />
      <Suspense fallback={null}>
        <ColorPickerModal />
        <SaveSceneModal />
        <SceneModal />
        <CarHeaterModal />
      </Suspense>
    </>
  );
};
