// https://github.com/pmndrs/jotai/issues/1529#issuecomment-1302156604
'use client';

import { useProvideWebsocketState } from '@/hooks/websocket';
import '@/styles/globals.css';
import { BottomNavigation } from '@/ui/BottomNavigation';
import { ColorPickerModal } from '@/ui/ColorPickerModal';
import { Navbar } from '@/ui/Navbar';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useProvideWebsocketState();

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
      <body className="flex h-screen flex-col overflow-hidden">
        <ColorPickerModal />
        <Navbar />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        <BottomNavigation />
      </body>
    </html>
  );
}
