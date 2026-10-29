import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { reloadForNewBuild } from '@/lib/staleBuild';

import { App } from './app';

// A chunk from the build this tab started with is gone after a deploy. The
// error still reaches the route's error screen, which says what's happening.
window.addEventListener('vite:preloadError', () => reloadForNewBuild());

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Failed to find the root element for the Vite app.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
