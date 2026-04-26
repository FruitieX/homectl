import { Provider as JotaiProvider } from 'jotai';
import { useProvideWebsocketState } from '@/hooks/websocket';
import '@/styles/globals.css';
import { HomectlBottomNavigation } from '@/ui/BottomNavigation';
import { Navbar } from '@/ui/Navbar';
import { useProvideAppConfig } from '@/hooks/appConfig';
import { useApplyTheme } from '@/hooks/theme';
import { Suspense, lazy, useEffect, type ReactNode } from 'react';

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
  return <JotaiProvider>{children}</JotaiProvider>;
};

export const ProvideAppConfig = ({ children }: { children: ReactNode }) => {
  const appConfigLoaded = useProvideAppConfig();
  if (!appConfigLoaded) return null;

  return children;
};

export const Layout = ({ children }: { children: ReactNode }) => {
  useProvideWebsocketState();
  useApplyTheme();

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
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
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
