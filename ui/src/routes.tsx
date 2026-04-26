import { Layout } from '../app/providers';
import ConfigLayout from '../app/config/layout';

import { useGroupsState } from '@/hooks/websocket';
import { Suspense, lazy, type ReactNode } from 'react';
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  useParams,
} from 'react-router-dom';

const DashboardPage = lazy(() => import('../app/dashboard/page'));
const ConfigDashboardPage = lazy(() => import('../app/config/dashboard/page'));
const ConfigDevicesPage = lazy(() => import('../app/config/devices/page'));
const ConfigFloorplanPage = lazy(() => import('../app/config/floorplan/page'));
const ConfigGroupsPage = lazy(() => import('../app/config/groups/page'));
const ConfigImportExportPage = lazy(
  () => import('../app/config/import-export/page'),
);
const ConfigIntegrationsPage = lazy(
  () => import('../app/config/integrations/page'),
);
const ConfigLogsPage = lazy(() => import('../app/config/logs/page'));
const ConfigMigrationPage = lazy(() => import('../app/config/migration/page'));
const ConfigRoutinesPage = lazy(() => import('../app/config/routines/page'));
const ConfigScenesPage = lazy(() => import('../app/config/scenes/page'));
const ConfigSettingsPage = lazy(() => import('../app/config/settings/page'));
const GroupsPage = lazy(() => import('../app/groups/page'));
const MapPage = lazy(() => import('../app/map/page'));
const SettingsPage = lazy(() => import('../app/settings/page'));
const SceneList = lazy(() =>
  import('../app/groups/[id]/SceneList').then(({ SceneList }) => ({
    default: SceneList,
  })),
);

function RouteLoading() {
  return (
    <div className="flex min-h-48 items-center justify-center p-6 text-base-content/70">
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

function GroupScenesRoute() {
  const { id } = useParams();
  const groups = useGroupsState();
  const groupDevices = id ? groups?.[id]?.device_keys : undefined;

  if (!groupDevices) {
    return null;
  }

  return <SceneList deviceKeys={groupDevices} />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootRouteLayout />,
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
        element: withSuspense(<GroupScenesRoute />),
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
            element: <Navigate to="/config/integrations" replace />,
          },
          {
            path: 'dashboard',
            element: withSuspense(<ConfigDashboardPage />),
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
            path: 'import-export',
            element: withSuspense(<ConfigImportExportPage />),
          },
          {
            path: 'integrations',
            element: withSuspense(<ConfigIntegrationsPage />),
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
            path: 'routines',
            element: withSuspense(<ConfigRoutinesPage />),
          },
          {
            path: 'scenes',
            element: withSuspense(<ConfigScenesPage />),
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
