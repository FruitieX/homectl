import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

type PackageManifest = { version?: string };

const packageManifest = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as PackageManifest;

function readGitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

const buildInfo = {
  version: process.env.VITE_APP_VERSION || packageManifest.version || '',
  gitCommit: process.env.VITE_GIT_COMMIT || readGitCommit(),
  buildDate: process.env.VITE_BUILD_DATE || new Date().toISOString(),
};

// Where the dev server forwards /api, /health and /ws to. Point it at a
// deployed backend to preview UI changes against real data; the browser then
// makes same-origin requests and no CORS allowance is needed there.
const apiTarget =
  process.env.HOMECTL_DEV_PROXY_TARGET || 'http://localhost:45289';
const wsTarget = apiTarget.replace(/^http/, 'ws');
// .env points API_ENDPOINT at a deployed instance. When the dev server is
// explicitly pointed somewhere else (a local backend or the offline fixture
// server) the app must make same-origin requests instead, otherwise it keeps
// talking to — and writing to — the deployed instance behind the proxy's back.
const proxyMode = Boolean(process.env.HOMECTL_DEV_PROXY_TARGET);

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'API_ENDPOINT'],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(buildInfo.version),
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(buildInfo.gitCommit),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(buildInfo.buildDate),
    ...(proxyMode
      ? { 'import.meta.env.API_ENDPOINT': JSON.stringify('') }
      : {}),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/health': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: wsTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
