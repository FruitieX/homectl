import { useMemo, useState } from 'react';
import { useDashboardSpacing } from '@/hooks/dashboardSpacing';
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
import { Button } from '@/ui/primitives/button';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { DetailPanel, Metric, WidgetCard, WidgetHeading } from './WidgetChrome';

const formatPrice = (value: number | undefined) =>
  value === undefined ? '—' : `${value.toFixed(2)} c/kWh`;

export const SpotPriceCard = ({ widget }: { widget?: DashboardWidget }) => {
  const [spacing] = useDashboardSpacing();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [chartInteracting, setChartInteracting] = useState(false);
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
      <WidgetCard interactive={!chartInteracting} className="group col-span-4">
        <div className="relative h-full w-full rounded-[inherit] text-left">
          <CardContent className="relative flex w-full flex-col p-[var(--widget-padding,1rem)]">
            <Button
              variant="ghost"
              aria-label="Open electricity price details"
              onClick={() => setDetailsOpen(true)}
              className="absolute inset-0 z-0 h-auto w-auto rounded-[inherit] p-0 text-left hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset"
            />
            <div className="pointer-events-none relative z-[1]">
              <WidgetHeading icon={<Zap />} label="Electricity price" detail />
              <div className="mt-3 flex items-end justify-between gap-4 px-1 pb-1">
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
            </div>
            <div
              className="relative z-[2]"
              onPointerDown={() => setChartInteracting(true)}
              onPointerUp={() => setChartInteracting(false)}
              onPointerCancel={() => setChartInteracting(false)}
              onPointerLeave={() => setChartInteracting(false)}
            >
              <ResponsiveChart
                height={
                  spacing === 'compact' ? 180 : spacing === 'spacious' ? 245 : 215
                }
                className="mt-1 min-w-0 overflow-hidden"
              >
                {({ width, height }) => (
                  <SpotPriceChart
                    data={data}
                    width={width}
                    height={height}
                    animate
                    showCurrentTime
                    showLegend={false}
                    showUnit={false}
                  />
                )}
              </ResponsiveChart>
            </div>
            {priceQuery.isError && (
              <p role="status" className="pointer-events-none relative z-[1] text-xs text-muted-foreground">
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
