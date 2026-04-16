import { Layout } from '../app/providers';
import ConfigLayout from '../app/config/layout';
import DashboardPage from '../app/dashboard/page';
import ConfigDashboardPage from '../app/config/dashboard/page';
import ConfigDevicesPage from '../app/config/devices/page';
import ConfigFloorplanPage from '../app/config/floorplan/page';
import ConfigGroupsPage from '../app/config/groups/page';
import ConfigImportExportPage from '../app/config/import-export/page';
import ConfigIntegrationsPage from '../app/config/integrations/page';
import ConfigLogsPage from '../app/config/logs/page';
import ConfigMigrationPage from '../app/config/migration/page';
import ConfigRoutinesPage from '../app/config/routines/page';
import ConfigScenesPage from '../app/config/scenes/page';
import ConfigSettingsPage from '../app/config/settings/page';
import GroupsPage from '../app/groups/page';
import MapPage from '../app/map/page';
import SettingsPage from '../app/settings/page';
import { SceneList } from '../app/groups/[id]/SceneList';

import { useWebsocketState } from '@/hooks/websocket';
import {
  Navigate,
  Outlet,
  createBrowserRouter,
  useParams,
} from 'react-router-dom';

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
  const state = useWebsocketState();
  const groupDevices = id ? state?.groups[id]?.device_keys : undefined;

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
        element: <DashboardPage />,
      },
      {
        path: 'dashboard',
        element: <DashboardPage />,
      },
      {
        path: 'groups',
        element: <GroupsPage />,
      },
      {
        path: 'groups/:id',
        element: <GroupScenesRoute />,
      },
      {
        path: 'map',
        element: <MapPage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
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
            element: <ConfigDashboardPage />,
          },
          {
            path: 'devices',
            element: <ConfigDevicesPage />,
          },
          {
            path: 'floorplan',
            element: <ConfigFloorplanPage />,
          },
          {
            path: 'groups',
            element: <ConfigGroupsPage />,
          },
          {
            path: 'import-export',
            element: <ConfigImportExportPage />,
          },
          {
            path: 'integrations',
            element: <ConfigIntegrationsPage />,
          },
          {
            path: 'logs',
            element: <ConfigLogsPage />,
          },
          {
            path: 'migration',
            element: <ConfigMigrationPage />,
          },
          {
            path: 'routines',
            element: <ConfigRoutinesPage />,
          },
          {
            path: 'scenes',
            element: <ConfigScenesPage />,
          },
          {
            path: 'settings',
            element: <ConfigSettingsPage />,
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