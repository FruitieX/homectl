import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import { useTimeout } from 'usehooks-ts';

import useIdle from '@/hooks/useIdle';
import { useSpotPriceQuery } from '@/hooks/influxdb';
import {
  type DashboardWidget,
  getDashboardWidgetOptionString,
} from '@/hooks/useDashboard';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import { SpotPriceChart, spotPriceToColor } from '@/ui/charts/SpotPriceChart';
import { CardContent } from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { DetailPanel, Metric, WidgetCard, WidgetHeading } from './WidgetChrome';

const formatPrice = (value: number | undefined) =>
  value === undefined ? '—' : `${value.toFixed(2)} c/kWh`;

export const SpotPriceCard = ({ widget }: { widget?: DashboardWidget }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isIdle = useIdle();
  const spotPrice = useSpotPriceQuery(
    getDashboardWidgetOptionString(
      widget,
      'spotPricePath',
      '/api/influxdb/spot-prices',
    ),
  );

  const data = useMemo(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return spotPrice
      .filter((row) => new Date(row._time).getTime() >= oneHourAgo)
      .map((row) => ({
        time: new Date(row._time).getTime(),
        value: row._value,
        fill: spotPriceToColor(row._value) || '#6b7280',
      }));
  }, [spotPrice]);

  const stats = useMemo(() => {
    if (data.length === 0) return null;
    const now = Date.now();
    const current = data.findLast((point) => point.time <= now) ?? data[0];
    const values = data.map((point) => point.value);
    return {
      current,
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      low: Math.min(...values),
      high: Math.max(...values),
    };
  }, [data]);

  useTimeout(
    () => setDetailsOpen(false),
    detailsOpen && isIdle ? 10 * 1000 : null,
  );

  return (
    <>
      <WidgetCard className="col-span-4 min-h-60">
        <div
          role="button"
          tabIndex={0}
          aria-label="Open electricity price details"
          className="group h-full w-full cursor-pointer rounded-[inherit] text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={() => setDetailsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setDetailsOpen(true);
            }
          }}
        >
          <CardContent className="flex w-full flex-col p-4 sm:p-5">
            <WidgetHeading icon={<Zap />} label="Electricity price" detail />
            <div className="mt-3 flex items-end justify-between gap-4 px-1">
              <div>
                <div className="text-xs text-muted-foreground">
                  Next 24 hours
                </div>
                {stats ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Avg {formatPrice(stats.average)}
                  </div>
                ) : null}
              </div>
              <div className="text-right">
                <div className="text-xs font-medium text-muted-foreground">
                  Now
                </div>
                <div
                  className="mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums"
                  style={{
                    color: stats
                      ? spotPriceToColor(stats.current.value)
                      : undefined,
                  }}
                >
                  {formatPrice(stats?.current.value)}
                </div>
              </div>
            </div>
            <ResponsiveChart
              height={175}
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
          </CardContent>
        </div>
      </WidgetCard>

      <ResponsiveOverlay
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Electricity prices"
        description="Hourly prices, including tax and configured adjustments."
        className="max-w-5xl"
      >
        <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DetailPanel>
              <Metric
                label="Current"
                value={formatPrice(stats?.current.value)}
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
