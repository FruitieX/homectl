import { Fragment, useEffect, useState, useRef, useMemo } from 'react';
import { useInterval, useTimeout, useToggle } from 'usehooks-ts';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useTempSensorsQuery } from '@/hooks/influxdb';
import useIdle from '@/hooks/useIdle';
import { useAppConfig } from '@/hooks/appConfig';
import {
  type DashboardWidget,
  buildDashboardWidgetProxyPath,
  getDashboardWidgetOptionNumber,
  getDashboardWidgetOptionString,
  resolveDashboardWidgetUrl,
} from '@/hooks/useDashboard';
import { getUvIndexColor } from '@/lib/uvIndex';
import { WeatherChart } from '@/ui/charts/WeatherChart';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent } from '@/ui/primitives/card';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Tabs, TabsList, TabsTrigger } from '@/ui/primitives/tabs';

type WeatherTimeSeries = {
  time: Date;
  data: {
    instant: {
      details: {
        air_pressure_at_sea_level: number;
        air_temperature: number;
        air_temperature_percentile_10: number;
        air_temperature_percentile_90: number;
        cloud_area_fraction: number;
        cloud_area_fraction_high: number;
        cloud_area_fraction_low: number;
        cloud_area_fraction_medium: number;
        dew_point_temperature: number;
        fog_area_fraction: number;
        relative_humidity: number;
        ultraviolet_index_clear_sky: number;
        wind_from_direction: number;
        wind_speed: number;
        wind_speed_of_gust: number;
        wind_speed_percentile_10: number;
        wind_speed_percentile_90: number;
      };
    };
    next_1_hours?: {
      details: {
        precipitation_amount: number;
        precipitation_amount_max: number;
        precipitation_amount_min: number;
        probability_of_precipitation: number;
        probability_of_thunder: number;
      };
      summary: {
        symbol_code: string;
      };
    };
    next_6_hours?: {
      details: {
        air_temperature_max?: number;
        air_temperature_min?: number;
        precipitation_amount?: number;
        precipitation_amount_max?: number;
        precipitation_amount_min?: number;
        probability_of_precipitation?: number;
      };
      summary?: {
        symbol_code: string;
      };
    };
    next_12_hours?: {
      details: {
        probability_of_precipitation?: number;
      };
      summary?: {
        symbol_code: string;
      };
    };
  };
};
type DailyWeatherData = {
  date: Date;
  minTemp: number;
  maxTemp: number;
  symbolCode: string;
  precipitation: number;
  representativeDataPoint: WeatherTimeSeries;
};

type WeatherResponse = {
  properties: {
    meta: {
      updated_at: string;
    };
    timeseries: WeatherTimeSeries[];
  };
};

const fetchWeather = async (weatherUrl: string): Promise<WeatherResponse> => {
  const res = await fetch(weatherUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch weather: ${res.status}`);
  }
  const json: WeatherResponse = await res.json();
  return json;
};

export const WeatherCard = ({ widget }: { widget?: DashboardWidget }) => {
  const { apiEndpoint } = useAppConfig();
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const weatherUrlOverride = getDashboardWidgetOptionString(
    widget,
    'weatherUrl',
    '',
  );
  const weatherPath = weatherUrlOverride
    ? buildDashboardWidgetProxyPath('/api/weather', { url: weatherUrlOverride })
    : getDashboardWidgetOptionString(widget, 'weatherPath', '/api/weather');
  const weatherUrl = resolveDashboardWidgetUrl(apiEndpoint, weatherPath);
  const forecastHours = getDashboardWidgetOptionNumber(
    widget,
    'forecastHours',
    48,
  );
  const forecastDays = getDashboardWidgetOptionNumber(
    widget,
    'forecastDays',
    5,
  );
  const refreshSeconds = getDashboardWidgetOptionNumber(
    widget,
    'refreshSeconds',
    60,
  );
  const outdoorSensorId = getDashboardWidgetOptionString(
    widget,
    'outdoorSensorId',
    'D83534387029',
  );
  const sensorPath = getDashboardWidgetOptionString(
    widget,
    'sensorPath',
    '/api/influxdb/temp-sensors',
  );

  const isIdle = useIdle();
  const [detailsModalOpen, toggleDetailsModal, setDetailsModalOpen] =
    useToggle(false);
  const [activeTab, setActiveTab] = useState(0);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  const tempSensors = useTempSensorsQuery(sensorPath);

  const latestFrontyardTemp = tempSensors?.findLast(
    (row) => row.device_id === outdoorSensorId,
  )?._value;

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      const weather = await fetchWeather(weatherUrl);
      if (isSubscribed === true) {
        setWeather(weather);
      }
    };
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, [weatherUrl]);

  useInterval(
    async () => {
      const weather = await fetchWeather(weatherUrl);
      setWeather(weather);
    },
    Math.max(30, refreshSeconds) * 1000,
  );

  useTimeout(
    () => {
      setDetailsModalOpen(false);
    },
    detailsModalOpen && isIdle ? 10 * 1000 : null,
  );

  // Reset scroll position and tab after the overlay closes.
  useEffect(() => {
    if (!detailsModalOpen) {
      // Wait for the close animation to complete before resetting.
      const timeoutId = setTimeout(() => {
        setActiveTab(0);
        if (modalBodyRef.current) {
          modalBodyRef.current.scrollTop = 0;
        }
      }, 300);

      return () => clearTimeout(timeoutId);
    }
  }, [detailsModalOpen]);

  // Memoize weather data transformations to prevent unnecessary re-renders
  const { currentAndFutureSeries, hourlyData, dailyData } = useMemo(() => {
    const roundToHour = (date: Date) => {
      const p = 60 * 60 * 1000; // milliseconds in an hour
      return new Date(Math.round(date.getTime() / p) * p);
    };

    const currentAndFutureSeries =
      weather?.properties.timeseries.filter((series) => {
        return new Date(series.time) >= roundToHour(new Date());
      }) ?? [];

    const hourlyData = currentAndFutureSeries?.slice(0, forecastHours) || [];

    // Aggregate daily data for next 5 days with min/max values and improved symbol code logic
    const dailyData: DailyWeatherData[] = currentAndFutureSeries
      ? (() => {
          // Group data points by date
          const dailyGroups = new Map<string, WeatherTimeSeries[]>();

          currentAndFutureSeries.forEach((series) => {
            const dateKey = new Date(series.time).toDateString();
            if (!dailyGroups.has(dateKey)) {
              dailyGroups.set(dateKey, []);
            }
            dailyGroups.get(dateKey)!.push(series);
          });

          // Process each day to get aggregated data
          return Array.from(dailyGroups.entries())
            .slice(0, forecastDays)
            .map(([dateKey, dayDataPoints]) => {
              const date = new Date(dateKey);

              // Find symbol code: prioritize data points closest to noon with next_12_hours available
              let bestSymbolDataPoint = dayDataPoints[0];
              let bestNoonDistance = 24; // Initialize with max possible distance

              for (const dataPoint of dayDataPoints) {
                const hour = new Date(dataPoint.time).getHours();
                const noonDistance = Math.abs(hour - 12);

                // Prefer data points with next_12_hours, then closest to noon
                const hasNext12Hours =
                  !!dataPoint.data.next_12_hours?.summary?.symbol_code;
                const currentBestHas12Hours =
                  !!bestSymbolDataPoint.data.next_12_hours?.summary
                    ?.symbol_code;

                if (
                  (hasNext12Hours && !currentBestHas12Hours) ||
                  (hasNext12Hours === currentBestHas12Hours &&
                    noonDistance < bestNoonDistance)
                ) {
                  bestSymbolDataPoint = dataPoint;
                  bestNoonDistance = noonDistance;
                }
              }

              // Get symbol code with fallback priority
              const symbolCode =
                bestSymbolDataPoint.data.next_12_hours?.summary?.symbol_code ||
                bestSymbolDataPoint.data.next_6_hours?.summary?.symbol_code ||
                bestSymbolDataPoint.data.next_1_hours?.summary?.symbol_code ||
                'clearsky_day';

              // Aggregate min/max temperatures from all data points in the day
              const temperatures = dayDataPoints.map(
                (dp) => dp.data.instant.details.air_temperature,
              );
              const minTemp = Math.min(...temperatures);
              const maxTemp = Math.max(...temperatures);

              // Aggregate precipitation (use max precipitation for the day)
              const precipitationAmounts = dayDataPoints.map(
                (dp) =>
                  dp.data.next_1_hours?.details?.precipitation_amount ||
                  dp.data.next_6_hours?.details?.precipitation_amount ||
                  0,
              );
              const precipitation = Math.max(...precipitationAmounts);

              return {
                date,
                minTemp,
                maxTemp,
                symbolCode,
                precipitation,
                representativeDataPoint: bestSymbolDataPoint,
              };
            });
        })()
      : [];

    return { currentAndFutureSeries, hourlyData, dailyData };
  }, [forecastDays, forecastHours, weather]);

  // Limit chart data to the selected long-term range (5 days) matching dailyData
  const chartSeries = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + forecastDays * 24 * 60 * 60 * 1000);
    return currentAndFutureSeries.filter((s) => new Date(s.time) <= cutoff);
  }, [currentAndFutureSeries, forecastDays]);

  // Memoize chart data transformations
  const temperatureChartData = useMemo(() => {
    return chartSeries.map((series) => {
      const currentTemp = series.data.instant.details.air_temperature;
      const maxTemp =
        series.data.next_6_hours?.details?.air_temperature_max ||
        currentTemp + 3;
      const minTemp =
        series.data.next_6_hours?.details?.air_temperature_min ||
        currentTemp - 3;

      return {
        time: new Date(series.time),
        temp: currentTemp,
        temp_percentile_10:
          series.data.instant.details.air_temperature_percentile_10,
        temp_percentile_90:
          series.data.instant.details.air_temperature_percentile_90,
      };
    });
  }, [chartSeries]);

  const precipitationChartData = useMemo(() => {
    return chartSeries.map((series) => ({
      time: new Date(series.time),
      precipitation_amount:
        series.data.next_1_hours?.details?.precipitation_amount ||
        series.data.next_6_hours?.details?.precipitation_amount ||
        0,
      precipitation_amount_max:
        series.data.next_1_hours?.details?.precipitation_amount_max ||
        series.data.next_6_hours?.details?.precipitation_amount_max ||
        0,
      precipitation_amount_min:
        series.data.next_1_hours?.details?.precipitation_amount_min ||
        series.data.next_6_hours?.details?.precipitation_amount_min ||
        0,
      probability_of_precipitation:
        series.data.next_1_hours?.details?.probability_of_precipitation ||
        series.data.next_6_hours?.details?.probability_of_precipitation ||
        0,
    }));
  }, [chartSeries]);

  const windChartData = useMemo(() => {
    return chartSeries.map((series) => ({
      time: new Date(series.time),
      wind_speed: series.data.instant.details.wind_speed,
      wind_speed_of_gust: series.data.instant.details.wind_speed_of_gust,
      wind_speed_percentile_10:
        series.data.instant.details.wind_speed_percentile_10,
      wind_speed_percentile_90:
        series.data.instant.details.wind_speed_percentile_90,
    }));
  }, [chartSeries]);

  return (
    <>
      <Card className="col-span-1 overflow-hidden">
        <Button
          variant="ghost"
          className="h-full w-full"
          onClick={toggleDetailsModal}
        >
          <CardContent className="p-5">
            {renderWeatherDetail(
              currentAndFutureSeries[0],
              true,
              latestFrontyardTemp ? Math.round(latestFrontyardTemp) : undefined,
            )}
          </CardContent>
        </Button>
      </Card>
      <ResponsiveOverlay
        open={detailsModalOpen}
        onOpenChange={setDetailsModalOpen}
        title="Weather forecast"
        description="Hourly and five-day forecast details."
        className="max-w-5xl"
      >
        <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
          <div className="flex items-center justify-end">
            <Button onClick={toggleDetailsModal} variant="outline" size="icon">
              <X />
            </Button>
          </div>
          <Tabs
            value={String(activeTab)}
            onValueChange={(value) => setActiveTab(Number(value))}
          >
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="0">Hourly ({forecastHours}h)</TabsTrigger>
              <TabsTrigger value="1">Long-term ({forecastDays}d)</TabsTrigger>
            </TabsList>
          </Tabs>

          <div
            ref={modalBodyRef}
            className="relative flex flex-col gap-3 overflow-x-hidden pb-4"
          >
            {activeTab === 0 && (
              <>
                {hourlyData.map((series, index) => {
                  const rainProbability =
                    series.data.next_1_hours?.details
                      ?.probability_of_precipitation || 0;
                  const currentDate = new Date(series.time);
                  const prevDate =
                    index > 0 ? new Date(hourlyData[index - 1].time) : null;
                  const isNewDay =
                    index === 0 ||
                    (prevDate && currentDate.getDate() !== prevDate.getDate());

                  return (
                    <Fragment key={index}>
                      {index === 0 && (
                        <div className="sticky top-0 z-20 flex flex-row rounded-2xl border border-border bg-popover/95 px-3 py-2 text-base shadow-sm backdrop-blur">
                          <span className="w-24 text-sm text-muted-foreground">
                            Time
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Forecast
                          </span>
                          <span className="flex-1 text-right text-sm text-muted-foreground">
                            Rain probability
                          </span>
                        </div>
                      )}
                      {isNewDay && (
                        <div>
                          <div className="-mx-2 flex items-center px-2 py-3">
                            <div className="h-px flex-1 bg-border"></div>
                            <div className="px-4 text-sm font-semibold text-muted-foreground">
                              {currentDate.toLocaleDateString('en-FI', {
                                weekday: 'long',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </div>
                            <div className="h-px flex-1 bg-border"></div>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-row items-center">
                        <div className="w-24 text-2xl flex flex-col items-start">
                          <span>
                            {currentDate.toLocaleTimeString('fi-FI', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        {renderWeatherDetail(series, false)}
                        <span className="flex-1" />
                        <span
                          className={clsx(
                            'flex items-center',
                            rainProbability > 20
                              ? rainProbability > 50
                                ? 'text-red-500'
                                : 'text-yellow-500'
                              : 'text-green-500',
                          )}
                          title={`${Math.round(rainProbability)}% chance of precipitation in the next hour`}
                        >
                          {Math.round(rainProbability)} %
                        </span>
                      </div>
                    </Fragment>
                  );
                })}
              </>
            )}

            {activeTab === 1 && (
              <>
                {/* Daily forecast cards (stretched to fill width) */}
                <div className="flex flex-row gap-2 w-full">
                  {dailyData.map((dayData, index) => {
                    const today = new Date();
                    const isToday =
                      dayData.date.toDateString() === today.toDateString();

                    return (
                      <div
                        key={index}
                        className="flex-1 rounded-2xl border border-border bg-muted/50 p-3 text-center"
                      >
                        <div className="text-sm font-semibold mb-2">
                          {isToday
                            ? 'Today'
                            : dayData.date.toLocaleDateString('en-US', {
                                weekday: 'short',
                              })}
                        </div>
                        <div className="mb-2 text-xs text-muted-foreground">
                          {dayData.date.toLocaleDateString('en-FI', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </div>
                        <img
                          className="w-12 h-12 mx-auto mb-2"
                          src={`/weathericons/${dayData.symbolCode}.svg`}
                          alt="Weather icon"
                        />
                        <div className="text-lg font-bold">
                          {Math.round(dayData.maxTemp)}°
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {Math.round(dayData.minTemp)}°
                        </div>
                        <div className="mt-1 text-xs text-sky-500">
                          {dayData.precipitation > 0
                            ? `${dayData.precipitation.toFixed(1)}mm`
                            : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Temperature chart */}
                <div>
                  <ResponsiveChart
                    height={250}
                    className="overflow-hidden rounded-2xl bg-muted/40"
                  >
                    {({ width, height }) => (
                      <WeatherChart
                        data={temperatureChartData}
                        width={width}
                        height={height}
                        chartType="temperature"
                        animate={true}
                      />
                    )}
                  </ResponsiveChart>
                </div>

                {/* Precipitation chart */}
                <div>
                  <ResponsiveChart
                    height={250}
                    className="overflow-hidden rounded-2xl bg-muted/40"
                  >
                    {({ width, height }) => (
                      <WeatherChart
                        data={precipitationChartData}
                        width={width}
                        height={height}
                        chartType="precipitation"
                        animate={true}
                      />
                    )}
                  </ResponsiveChart>
                </div>

                {/* Wind speed chart */}
                <div>
                  <ResponsiveChart
                    height={250}
                    className="overflow-hidden rounded-2xl bg-muted/40"
                  >
                    {({ width, height }) => (
                      <WeatherChart
                        data={windChartData}
                        width={width}
                        height={height}
                        chartType="wind"
                        animate={true}
                      />
                    )}
                  </ResponsiveChart>
                </div>
              </>
            )}
          </div>
        </div>
      </ResponsiveOverlay>
    </>
  );
};

const renderWeatherDetail = (
  series?: WeatherTimeSeries,
  horizontal?: boolean,
  overrideTemp?: string | number,
) => {
  if (series === undefined) {
    return null;
  }

  return (
    <div
      className={clsx(
        'flex items-center justify-center',
        horizontal ? 'flex-col' : 'gap-3',
      )}
    >
      <img
        className="w-16"
        src={`/weathericons/${series.data.next_1_hours?.summary?.symbol_code || series.data.next_6_hours?.summary?.symbol_code || 'clearsky_day'}.svg`}
        alt="Weather icon"
      />
      <div className={clsx('flex flex-col', horizontal ? 'items-center' : '')}>
        <span className="whitespace-nowrap text-2xl">
          {overrideTemp !== undefined
            ? overrideTemp
            : Math.round(series.data.instant.details.air_temperature)}{' '}
          °C
        </span>
        <span className="flex gap-2">
          <span className="text-sm text-muted-foreground">
            {Math.round(series.data.instant.details.wind_speed)} m/s
          </span>
          {series.data.instant.details.ultraviolet_index_clear_sky !==
            undefined && (
            <span
              className={clsx(
                'text-sm text-muted-foreground',
                getUvIndexColor(
                  series.data.instant.details.ultraviolet_index_clear_sky,
                ),
              )}
            >
              UV{' '}
              {Math.round(
                series.data.instant.details.ultraviolet_index_clear_sky,
              )}
            </span>
          )}
        </span>
      </div>
    </div>
  );
};
