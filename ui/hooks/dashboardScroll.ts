import { useAtom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

const dashboardScrollEnabledAtom = atomWithStorage<boolean>(
  'homectl-dashboard-scroll-enabled',
  true,
);

export const useDashboardScroll = () => useAtom(dashboardScrollEnabledAtom);
