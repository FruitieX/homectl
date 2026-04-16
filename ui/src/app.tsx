import { Providers, ProvideAppConfig } from '../app/providers';
import { router } from './routes';

import { RouterProvider } from 'react-router-dom';

export function App() {
  return (
    <Providers>
      <ProvideAppConfig>
        <RouterProvider router={router} />
      </ProvideAppConfig>
    </Providers>
  );
}