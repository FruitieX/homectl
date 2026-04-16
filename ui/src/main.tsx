import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Failed to find the root element for the Vite app.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);