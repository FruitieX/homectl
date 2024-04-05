import '@/styles/globals.css';
import { Providers, ProvideAppConfig, Layout } from './providers';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
        <Providers>
          <ProvideAppConfig>
            <Layout>{children}</Layout>
          </ProvideAppConfig>
        </Providers>
      </body>
    </html>
  );
}
