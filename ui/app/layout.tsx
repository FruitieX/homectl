import '@/styles/globals.css';
import { Providers, ProvideAppConfig, Layout } from './providers';

// Script to apply theme before React hydrates to prevent flash
const themeScript = `
(function() {
  try {
    const stored = localStorage.getItem('homectl-theme');
    const theme = stored ? JSON.parse(stored) : 'auto';
    let effectiveTheme = theme;
    if (theme === 'auto') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.classList.toggle('dark', effectiveTheme === 'dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

const visualEffectsScript = `
(function() {
  try {
    const stored = localStorage.getItem('homectl-backdrop-blur-effects');
    const enabled = stored === null ? true : JSON.parse(stored) !== false;
    document.documentElement.classList.toggle('homectl-disable-backdrop-blur', !enabled);
  } catch (e) {
    document.documentElement.classList.remove('homectl-disable-backdrop-blur');
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: visualEffectsScript }} />
        <meta
          name="viewport"
          content="minimum-scale=1, initial-scale=1, width=device-width, shrink-to-fit=no, user-scalable=no, viewport-fit=cover"
        />
        <link rel="icon" type="image/png" href="/homectl-icon.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body
        className="flex flex-col overflow-hidden bg-background text-foreground antialiased"
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
