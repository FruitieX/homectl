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
    const daisyuiTheme = effectiveTheme === 'dark' ? 'business' : 'corporate';
    document.documentElement.setAttribute('data-theme', daisyuiTheme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'business');
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
