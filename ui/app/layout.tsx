// https://github.com/pmndrs/jotai/issues/1529#issuecomment-1302156604
'use client';

import { useProvideWebsocketState } from '@/hooks/websocket';
import '@/styles/globals.css';
import { BottomNavigation } from '@/ui/BottomNavigation';
import { ColorPickerModal } from '@/ui/ColorPickerModal';
import { Navbar } from '@/ui/Navbar';
import { SaveSceneModal } from '@/ui/SaveSceneModal';
import { SceneModal } from '@/ui/SceneModal';
import { useProvideAppConfig } from '@/hooks/appConfig';
import { useEffect } from 'react';

const Layout = ({ children }: { children: React.ReactNode }) => {
  useProvideWebsocketState();

  return (
    <>
      <ColorPickerModal />
      <SaveSceneModal />
      <SceneModal />
      <Navbar />
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <BottomNavigation />
    </>
  );
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const appConfigLoaded = useProvideAppConfig();

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
    <html>
      <head>
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover"
        />
        <link rel="icon" type="image/png" href="/homectl-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body
        className="flex flex-col overflow-hidden"
        // Disables scrolling on iOS Safari
        style={{ touchAction: 'none' }}
      >
        {appConfigLoaded && <Layout>{children}</Layout>}
      </body>
    </html>
  );
}
