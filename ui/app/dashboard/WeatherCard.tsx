import { Fragment, useEffect, useState, useRef, useMemo } from 'react';
import { Button, Card, Modal, Tabs } from 'react-daisyui';
import { useInterval, useTimeout, useToggle } from 'usehooks-ts';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useTempSensorsQuery } from '@/hooks/influxdb';
import useIdle from '@/hooks/useIdle';
import { getUvIndexColor } from '@/lib/uvIndex';
import { WeatherChart } from '@/ui/charts/WeatherChart';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';

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
type WeatherResponse = {
  properties: {
    meta: {
      updated_at: string;
    };
    timeseries: WeatherTimeSeries[];
  };
};

const fetchWeather = async (): Promise<WeatherResponse> => {
  const res = await fetch('/api/weather');
  if (!res.ok) {
    throw new Error(`Failed to fetch weather: ${res.status}`);
  }
  const json: WeatherResponse = await res.json();
  return json;
};

export const WeatherCard = () => {
  const [weather, setWeather] = useState<WeatherResponse | null>(null);

  const isIdle = useIdle();
  const [detailsModalOpen, toggleDetailsModal, setDetailsModalOpen] =
    useToggle(false);
  const [activeTab, setActiveTab] = useState(0);
  const modalBodyRef = useRef<HTMLDivElement>(null);

  const tempSensors = useTempSensorsQuery();

  const latestFrontyardTemp = tempSensors?.findLast(
    (row) => row.device_id === 'D83534387029',
  )?._value;

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      const weather = await fetchWeather();
      if (isSubscribed === true) {
        setWeather(weather);
      }
    };
    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, []);

  useInterval(async () => {
    const weather = await fetchWeather();
    setWeather(weather);
  }, 60 * 1000);

  useTimeout(
    () => {
      setDetailsModalOpen(false);
    },
    detailsModalOpen && isIdle ? 10 * 1000 : null,
  );

  // Reset scroll position and tab when modal closes (after animation)
  useEffect(() => {
    if (!detailsModalOpen) {
      // Wait for modal close animation to complete before resetting
      const timeoutId = setTimeout(() => {
        setActiveTab(0);
        if (modalBodyRef.current) {
          modalBodyRef.current.scrollTop = 0;
        }
      }, 300); // Modal animation duration

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

    // Get hourly data for next 48 hours
    const hourlyData = currentAndFutureSeries?.slice(0, 48) || [];

    // Get daily data for next 7 days (one entry per unique date)
    const dailyData = currentAndFutureSeries
      ? currentAndFutureSeries
          .reduce((acc: WeatherTimeSeries[], series) => {
            const currentDate = new Date(series.time).toDateString();
            const existingDateIndex = acc.findIndex(
              (item) => new Date(item.time).toDateString() === currentDate,
            );

            if (existingDateIndex === -1) {
              // New date, add this entry
              acc.push(series);
            } else {
              // Date already exists, replace if this entry is closer to noon
              const currentHour = new Date(series.time).getHours();
              const existingHour = new Date(
                acc[existingDateIndex].time,
              ).getHours();
              const noonDistance = Math.abs(currentHour - 12);
              const existingNoonDistance = Math.abs(existingHour - 12);

              if (noonDistance < existingNoonDistance) {
                acc[existingDateIndex] = series;
              }
            }

            return acc;
          }, [])
          .slice(0, 7)
      : [];

    return { currentAndFutureSeries, hourlyData, dailyData };
  }, [weather]);

  // Memoize chart data transformations
  const temperatureChartData = useMemo(() => {
    return currentAndFutureSeries.map((series) => {
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
  }, [currentAndFutureSeries]);

  const precipitationChartData = useMemo(() => {
    return currentAndFutureSeries.map((series) => ({
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
  }, [currentAndFutureSeries]);

  const windChartData = useMemo(() => {
    return currentAndFutureSeries.map((series) => ({
      time: new Date(series.time),
      wind_speed: series.data.instant.details.wind_speed,
      wind_speed_of_gust: series.data.instant.details.wind_speed_of_gust,
      wind_speed_percentile_10:
        series.data.instant.details.wind_speed_percentile_10,
      wind_speed_percentile_90:
        series.data.instant.details.wind_speed_percentile_90,
    }));
  }, [currentAndFutureSeries]);

  return (
    <>
      <Card compact className="col-span-1 bg-base-300">
        <Button color="ghost" className="h-full" onClick={toggleDetailsModal}>
          <Card.Body>
            {renderWeatherDetail(
              currentAndFutureSeries[0],
              true,
              latestFrontyardTemp ? Math.round(latestFrontyardTemp) : undefined,
            )}
          </Card.Body>
        </Button>
      </Card>
      <Modal.Legacy
        open={detailsModalOpen}
        onClickBackdrop={toggleDetailsModal}
        responsive
        className="py-0"
      >
        <Modal.Header className="sticky w-auto top-0 p-6 m-0 -mx-6 z-10 bg-base-100 bg-opacity-75 backdrop-blur-sm">
          <div className="flex items-center justify-between font-bold mb-4">
            <div className="mx-4 text-center">Weather forecast</div>
            <Button onClick={toggleDetailsModal} variant="outline">
              <X />
            </Button>
          </div>

          <Tabs
            className="flex-nowrap overflow-x-auto"
            variant="bordered"
            size="lg"
          >
            <Tabs.Tab active={activeTab === 0} onClick={() => setActiveTab(0)}>
              Hourly (48h)
            </Tabs.Tab>
            <Tabs.Tab active={activeTab === 1} onClick={() => setActiveTab(1)}>
              Long-term (7d)
            </Tabs.Tab>
          </Tabs>
        </Modal.Header>

        <Modal.Body
          ref={modalBodyRef}
          className="flex flex-col gap-3 relative overflow-y-auto overflow-x-hidden max-h-[70vh] pr-4 -mr-4 pb-4"
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
                      <div className="sticky top-0 z-20 bg-base-100 flex flex-row pb-3 text-base border-b">
                        <span className="stat-title w-24">Time</span>
                        <span className="stat-title">Forecast</span>
                        <span className="stat-title flex-1 text-right">
                          Rain probability
                        </span>
                      </div>
                    )}
                    {isNewDay && (
                      <div className="bg-base-100">
                        <div className="flex items-center py-3 -mx-6 px-6">
                          <div className="flex-1 h-px bg-gray-300"></div>
                          <div className="px-4 text-sm font-semibold text-gray-600">
                            {currentDate.toLocaleDateString('en-FI', {
                              weekday: 'long',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </div>
                          <div className="flex-1 h-px bg-gray-300"></div>
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
              {/* Daily forecast cards */}
              <div className="overflow-x-auto flex flex-row gap-2 flex-shrink-0">
                {dailyData.map((series, index) => {
                  const date = new Date(series.time);
                  const today = new Date();
                  const isToday = date.toDateString() === today.toDateString();
                  const minTemp =
                    series.data.next_6_hours?.details?.air_temperature_min;
                  const maxTemp =
                    series.data.next_6_hours?.details?.air_temperature_max;
                  const precipitation =
                    series.data.next_6_hours?.details?.precipitation_amount ||
                    0;

                  return (
                    <div
                      key={index}
                      className="bg-base-200 rounded-lg p-3 text-center w-18 flex-shrink-0"
                    >
                      <div className="text-sm font-semibold mb-2">
                        {isToday
                          ? 'Today'
                          : date.toLocaleDateString('en-US', {
                              weekday: 'short',
                            })}
                      </div>
                      <div className="text-xs text-gray-600 mb-2">
                        {date.toLocaleDateString('en-FI', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                      <img
                        className="w-12 h-12 mx-auto mb-2"
                        src={`/weathericons/${series.data.next_6_hours?.summary?.symbol_code || series.data.next_1_hours?.summary?.symbol_code || 'clearsky_day'}.svg`}
                        alt="Weather icon"
                      />
                      <div className="text-lg font-bold">
                        {maxTemp !== undefined && Math.round(maxTemp)}°
                      </div>
                      <div className="text-sm text-gray-600">
                        {minTemp !== undefined && Math.round(minTemp)}°
                      </div>
                      <div className="text-xs text-blue-600 mt-1">
                        {precipitation > 0
                          ? `${precipitation.toFixed(1)}mm`
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
                  className="rounded-lg overflow-hidden bg-base-200/50"
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
                  className="rounded-lg overflow-hidden bg-base-200/50"
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
                  className="rounded-lg overflow-hidden bg-base-200/50"
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
        </Modal.Body>
      </Modal.Legacy>
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
      />
      <div className={clsx('flex flex-col', horizontal ? 'items-center' : '')}>
        <span className="whitespace-nowrap text-2xl">
          {overrideTemp !== undefined
            ? overrideTemp
            : Math.round(series.data.instant.details.air_temperature)}{' '}
          °C
        </span>
        <span className="flex gap-2">
          <span className="stat-title">
            {Math.round(series.data.instant.details.wind_speed)} m/s
          </span>
          {series.data.instant.details.ultraviolet_index_clear_sky !==
            undefined && (
            <span
              className={clsx(
                'stat-title',
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
