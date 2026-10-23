import { Providers, ProvideAppConfig } from '../app/providers';
import { AuthGate } from '../ui/auth/AuthGate';
import { router } from './routes';

import { RouterProvider } from 'react-router-dom';

export function App() {
  return (
    <Providers>
      <AuthGate>
        <ProvideAppConfig>
          <RouterProvider router={router} />
        </ProvideAppConfig>
      </AuthGate>
    </Providers>
  );
}
