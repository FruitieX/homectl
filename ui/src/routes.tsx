import { Layout } from '../app/providers';
import ConfigLayout from '../app/config/layout';

import { RouteErrorScreen } from './RouteErrorScreen';

import { Suspense, lazy, type ReactNode } from 'react';
import { Outlet, createBrowserRouter } from 'react-router-dom';
import { Navigate } from 'react-router-dom';

const DashboardPage = lazy(() => import('../app/dashboard/page'));
const ConfigDevicesPage = lazy(() => import('../app/config/devices/page'));
const ConfigFloorplanPage = lazy(() => import('../app/config/floorplan/page'));
const ConfigGroupsPage = lazy(() => import('../app/config/groups/page'));
const ConfigGroupDetailPage = lazy(() => import('../app/config/groups/detail'));
const ConfigSceneDetailPage = lazy(() => import('../app/config/scenes/detail'));
const ConfigSceneNewPage = lazy(() => import('../app/config/scenes/new'));
const ConfigGroupNewPage = lazy(() => import('../app/config/groups/new'));
const ConfigHelpersPage = lazy(() => import('../app/config/helpers/page'));
const ConfigImportExportPage = lazy(
  () => import('../app/config/import-export/page'),
);
const ConfigIntegrationsPage = lazy(
  () => import('../app/config/integrations/page'),
);
const ConfigLogsPage = lazy(() => import('../app/config/logs/page'));
const ConfigMigrationPage = lazy(() => import('../app/config/migration/page'));
const ConfigDiagnosticsPage = lazy(
  () => import('../app/config/diagnostics/page'),
);
const ConfigPage = lazy(() => import('../app/config/page'));
const ConfigRoutineHistoryPage = lazy(
  () => import('../app/config/routine-history/page'),
);
const ConfigRoutinesPage = lazy(() => import('../app/config/routines/page'));
const ConfigRoutineNewPage = lazy(() => import('../app/config/routines/new'));
const ConfigRoutineDetailPage = lazy(
  () => import('../app/config/routines/detail'),
);
const ConfigScenesPage = lazy(() => import('../app/config/scenes/page'));
const ConfigSettingsPage = lazy(() => import('../app/config/settings/page'));
const ConfigSourcesPage = lazy(() => import('../app/config/sources/page'));
const GroupViewport = lazy(() => import('../app/groups/GroupViewport'));
const GroupsPage = lazy(() => import('../app/groups/page'));
const MapPage = lazy(() => import('../app/map/page'));
const SettingsPage = lazy(() => import('../app/settings/page'));

function RouteLoading() {
  return (
    <div className="flex min-h-48 items-center justify-center p-6 text-muted-foreground">
      Loading…
    </div>
  );
}

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

function RootRouteLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function ConfigRouteLayout() {
  return (
    <ConfigLayout>
      <Outlet />
    </ConfigLayout>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootRouteLayout />,
    // Without this, any render error replaces the app with React Router's
    // minified stack trace, which is unreadable on a phone.
    errorElement: <RouteErrorScreen />,
    children: [
      {
        index: true,
        element: withSuspense(<DashboardPage />),
      },
      {
        path: 'dashboard',
        element: withSuspense(<DashboardPage />),
      },
      {
        path: 'groups',
        element: withSuspense(<GroupsPage />),
      },
      {
        path: 'groups/:id',
        element: withSuspense(<GroupViewport />),
      },
      {
        path: 'map',
        element: withSuspense(<MapPage />),
      },
      {
        path: 'settings',
        element: withSuspense(<SettingsPage />),
      },
      {
        path: 'config',
        element: <ConfigRouteLayout />,
        children: [
          {
            index: true,
            element: withSuspense(<ConfigPage />),
          },
          {
            path: 'devices',
            element: withSuspense(<ConfigDevicesPage />),
          },
          {
            path: 'floorplan',
            element: withSuspense(<ConfigFloorplanPage />),
          },
          {
            path: 'groups',
            element: withSuspense(<ConfigGroupsPage />),
          },
          {
            path: 'groups/new',
            element: withSuspense(<ConfigGroupNewPage />),
          },
          {
            path: 'groups/:id',
            element: withSuspense(<ConfigGroupDetailPage />),
          },
          {
            path: 'import-export',
            element: withSuspense(<ConfigImportExportPage />),
          },
          {
            path: 'integrations',
            element: withSuspense(<ConfigIntegrationsPage />),
          },
          {
            path: 'diagnostics',
            element: withSuspense(<ConfigDiagnosticsPage />),
          },
          {
            path: 'logs',
            element: withSuspense(<ConfigLogsPage />),
          },
          {
            path: 'migration',
            element: withSuspense(<ConfigMigrationPage />),
          },
          {
            path: 'helpers',
            element: withSuspense(<ConfigHelpersPage />),
          },
          {
            path: 'routines/new',
            element: withSuspense(<ConfigRoutineNewPage />),
          },
          {
            path: 'routines',
            element: withSuspense(<ConfigRoutinesPage />),
          },
          {
            path: 'routines/:id',
            element: withSuspense(<ConfigRoutineDetailPage />),
          },
          {
            path: 'routine-history',
            element: withSuspense(<ConfigRoutineHistoryPage />),
          },
          {
            path: 'scenes',
            element: withSuspense(<ConfigScenesPage />),
          },
          {
            path: 'scenes/new',
            element: withSuspense(<ConfigSceneNewPage />),
          },
          {
            path: 'scenes/:id',
            element: withSuspense(<ConfigSceneDetailPage />),
          },
          {
            path: 'sources',
            element: withSuspense(<ConfigSourcesPage />),
          },
          {
            path: 'settings',
            element: withSuspense(<ConfigSettingsPage />),
          },
        ],
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
