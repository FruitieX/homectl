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

export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'API_ENDPOINT'],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(buildInfo.version),
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(buildInfo.gitCommit),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(buildInfo.buildDate),
  },
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:45289',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:45289',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:45289',
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
