import path from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      'next/dynamic': path.resolve(__dirname, 'src/shims/next-dynamic.tsx'),
      'next/link': path.resolve(__dirname, 'src/shims/next-link.tsx'),
      'next/navigation': path.resolve(
        __dirname,
        'src/shims/next-navigation.ts',
      ),
      'next/server': path.resolve(__dirname, 'src/shims/next-server.ts'),
    },
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
});