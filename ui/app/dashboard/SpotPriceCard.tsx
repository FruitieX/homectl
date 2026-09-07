import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { useTimeout } from 'usehooks-ts';

import useIdle from '@/hooks/useIdle';
import { useSpotPriceResource } from '@/hooks/influxdb';
import { priceWindow } from '@/lib/widgetData';
import { useInterval } from 'usehooks-ts';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
} from '@/hooks/useDashboard';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import { SpotPriceChart } from '@/ui/charts/SpotPriceChart';
import { CardContent } from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { DetailPanel, Metric, WidgetCard, WidgetHeading } from './WidgetChrome';

const formatPrice = (value: number | undefined) =>
  value === undefined ? '—' : `${value.toFixed(2)} c/kWh`;

export const SpotPriceCard = ({ widget }: { widget?: DashboardWidget }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isIdle = useIdle();
  const priceQuery = useSpotPriceResource(
    getDashboardWidgetOptionString(
      widget,
      'spotPricePath',
      '/api/influxdb/spot-prices',
    ),
  );

  const [now, setNow] = useState(Date.now);
  useInterval(() => setNow(Date.now()), 30000);
  const { data, current, average } = useMemo(
    () => priceWindow(priceQuery.rows, now),
    [priceQuery.rows, now],
  );

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const values = data.map((point) => point.value);
    return {
      current,
      average,
      low: Math.min(...values),
      high: Math.max(...values),
    };
  }, [data, current, average]);

  useTimeout(
    () => setDetailsOpen(false),
    detailsOpen && isIdle ? 10 * 1000 : null,
  );

  return (
    <>
      <WidgetCard className="col-span-4 min-h-60">
        <div className="h-full w-full rounded-[inherit] text-left">
          <CardContent className="flex w-full flex-col p-4 sm:p-5">
            <button
              type="button"
              aria-label="Open electricity price details"
              onClick={() => setDetailsOpen(true)}
              className="group w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <WidgetHeading icon={<Zap />} label="Electricity price" detail />
            </button>
            <div className="mt-3 flex items-end justify-between gap-4 px-1">
              <div>
                <div className="text-xs text-muted-foreground">
                  Next 24 hours
                </div>
                {stats ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Average {formatPrice(stats.average)}
                  </div>
                ) : null}
              </div>
              <div className="text-right">
                <div className="text-xs font-medium text-muted-foreground">
                  Now
                </div>
                <div className="mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums">
                  {formatPrice(stats?.current?.value)}
                </div>
              </div>
            </div>
            <ResponsiveChart
              height={215}
              className="mt-1 min-w-0 overflow-hidden"
            >
              {({ width, height }) => (
                <SpotPriceChart
                  data={data}
                  width={width}
                  height={height}
                  animate
                  showCurrentTime
                />
              )}
            </ResponsiveChart>
            {priceQuery.isError && (
              <p role="status" className="text-xs text-muted-foreground">
                Prices could not be refreshed
                {data.length ? '; showing earlier results.' : '.'}
              </p>
            )}
          </CardContent>
        </div>
      </WidgetCard>

      <ResponsiveOverlay
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Electricity prices"
        description="Available prices for the next 24 hours, in c/kWh."
        className="max-w-5xl"
      >
        <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailPanel>
              <Metric
                label="Current"
                value={formatPrice(stats?.current?.value)}
              />
            </DetailPanel>
            <DetailPanel>
              <Metric label="Average" value={formatPrice(stats?.average)} />
            </DetailPanel>
            <DetailPanel>
              <Metric label="Lowest" value={formatPrice(stats?.low)} />
            </DetailPanel>
            <DetailPanel>
              <Metric label="Highest" value={formatPrice(stats?.high)} />
            </DetailPanel>
          </div>
          <DetailPanel className="p-2 sm:p-3">
            <ResponsiveChart
              height={390}
              className="overflow-hidden rounded-xl"
            >
              {({ width, height }) => (
                <SpotPriceChart
                  data={data}
                  width={width}
                  height={height}
                  animate
                  showCurrentTime
                />
              )}
            </ResponsiveChart>
          </DetailPanel>
        </div>
      </ResponsiveOverlay>
    </>
  );
};
