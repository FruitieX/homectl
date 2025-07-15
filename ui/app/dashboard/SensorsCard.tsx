import { Badge, Button, Card, Modal } from 'react-daisyui';
import { useTimeout, useToggle } from 'usehooks-ts';
import {
  X,
  Thermometer,
  Droplets,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronLeft,
} from 'lucide-react';
import { useSensorData } from '@/hooks/influxdb';
import { SensorChart } from '@/ui/charts/SensorChart';
import { CombinedSensorsChart } from '@/ui/charts/CombinedSensorsChart';
import { ResponsiveChart } from '@/ui/charts/ResponsiveChart';
import clsx from 'clsx';
import { useState, useMemo } from 'react';
import useIdle from '@/hooks/useIdle';
import { getTemperatureColor } from '@/ui/charts/TemperatureSensorChart';
import { getHumidityColor } from '@/lib/humidityColors';
import {
  calculateTemperatureStats,
  calculateHumidityStats,
  formatStatValue,
  getTrendIcon,
  getTrendColor,
  isOffline,
  getOfflineStatus,
} from '@/lib/sensorStats';
import Tooltip from '@/ui/Tooltip';

interface SensorReading {
  time: Date;
  value: number;
  deviceId: string;
  deviceName: string;
  color: string;
}

interface SensorData {
  device_id: string;
  device_name: string;
  latest_temp?: number;
  latest_humidity?: number;
  latest_temp_time?: Date;
  latest_humidity_time?: Date;
  temp_data: Array<{ time: Date; value: number }>;
  humidity_data: Array<{ time: Date; value: number }>;
  is_priority: boolean;
  is_indoor: boolean;
  color: string;
}

interface SensorCardProps {
  sensor: SensorData;
  onClick: () => void;
}

const SensorCard: React.FC<SensorCardProps> = ({ sensor, onClick }) => {
  const tempOffline = isOffline(sensor.latest_temp_time);
  const humidityOffline = isOffline(sensor.latest_humidity_time);
  const bothOffline = tempOffline && humidityOffline;

  const tempStats = useMemo(
    () => calculateTemperatureStats(sensor.temp_data),
    [sensor.temp_data],
  );

  const humidityStats = useMemo(
    () => calculateHumidityStats(sensor.humidity_data),
    [sensor.humidity_data],
  );

  return (
    <Button
      color="ghost"
      className="h-auto p-2 flex-shrink-0 w-24"
      onClick={onClick}
    >
      <div
        className={clsx(
          'flex flex-col items-center gap-2 w-full',
          bothOffline && 'text-stone-500',
        )}
      >
        {/* Sensor name */}
        <div className="text-xs font-medium truncate w-full text-center">
          {sensor.device_name}
        </div>

        {/* Values */}
        <div className="flex flex-col gap-1 text-xs w-full">
          {/* Temperature */}
          <div className="flex items-center justify-center gap-1">
            <Thermometer
              size={12}
              className={tempOffline ? 'text-stone-400' : undefined}
              style={{
                color:
                  (typeof sensor.latest_temp === 'number' &&
                    !tempOffline &&
                    getTemperatureColor(sensor.latest_temp)) ||
                  undefined,
              }}
            />
            {typeof sensor.latest_temp === 'number' && !tempOffline ? (
              <div className="flex items-center gap-1">
                <span className="font-mono">
                  {sensor.latest_temp.toFixed(1)}°C
                </span>
                {tempStats && (
                  <span
                    className="text-xs"
                    style={{
                      color: getTrendColor(tempStats.trend, true),
                    }}
                  >
                    {getTrendIcon(tempStats.trend)}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-stone-500">--</span>
            )}
          </div>

          {/* Humidity */}
          <div className="flex items-center justify-center gap-1">
            <Droplets
              size={12}
              className={humidityOffline ? 'text-stone-400' : 'text-purple-500'}
              style={{
                color:
                  (typeof sensor.latest_humidity === 'number' &&
                    !humidityOffline &&
                    getHumidityColor(sensor.latest_humidity)) ||
                  undefined,
              }}
            />
            {typeof sensor.latest_humidity === 'number' && !humidityOffline ? (
              <div className="flex items-center gap-1">
                <span className="font-mono">
                  {sensor.latest_humidity.toFixed(1)}%
                </span>
                {humidityStats && (
                  <span
                    className="text-xs"
                    style={{
                      color: getTrendColor(humidityStats.trend, false),
                    }}
                  >
                    {getTrendIcon(humidityStats.trend)}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-stone-500">--</span>
            )}
          </div>
        </div>
      </div>
    </Button>
  );
};

export const SensorsCard = () => {
  const [detailsModalOpen, toggleDetailsModal, setDetailsModalOpen] =
    useToggle(false);
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'individual' | 'combined'>(
    'individual',
  );
  const [sensorFilter, setSensorFilter] = useState<'indoor' | 'outdoor'>(
    'indoor',
  );

  const isIdle = useIdle();
  const sensorData = useSensorData();

  // Memoize the chart data transformation for individual sensor
  const individualChartData = useMemo(() => {
    if (!activeSensorId) return [];

    const sensor = sensorData.find((s) => s.device_id === activeSensorId);
    if (!sensor) return [];

    // Combine temperature and humidity data by time
    const dataMap = new Map();

    sensor.temp_data.forEach(({ time, value }) => {
      const timeKey = time.getTime();
      if (!dataMap.has(timeKey)) {
        dataMap.set(timeKey, { time });
      }
      dataMap.get(timeKey).temp = value;
    });

    sensor.humidity_data.forEach(({ time, value }) => {
      const timeKey = time.getTime();
      if (!dataMap.has(timeKey)) {
        dataMap.set(timeKey, { time });
      }
      dataMap.get(timeKey).humidity = value;
    });

    return Array.from(dataMap.values()).sort(
      (a, b) => a.time.getTime() - b.time.getTime(),
    );
  }, [sensorData, activeSensorId]);

  // Memoize the combined chart data for filtered sensors
  const combinedChartData = useMemo(() => {
    const filteredSensors = sensorData.filter((sensor) =>
      sensorFilter === 'indoor' ? sensor.is_indoor : !sensor.is_indoor,
    );

    // Filter out sensors with gaps of 1h or more
    const activeSensors = filteredSensors.filter((sensor) => {
      const hasRecentTemp =
        sensor.latest_temp_time &&
        new Date().getTime() - sensor.latest_temp_time.getTime() <
          60 * 60 * 1000; // 1 hour
      const hasRecentHumidity =
        sensor.latest_humidity_time &&
        new Date().getTime() - sensor.latest_humidity_time.getTime() <
          60 * 60 * 1000; // 1 hour

      return hasRecentTemp || hasRecentHumidity;
    });

    const timeMap = new Map();

    activeSensors.forEach((sensor) => {
      sensor.temp_data.forEach(({ time, value }) => {
        const timeKey = time.getTime();
        if (!timeMap.has(timeKey)) {
          timeMap.set(timeKey, {
            time,
            tempReadings: [],
            humidityReadings: [],
          });
        }
        const entry = timeMap.get(timeKey);
        // Deduplicate by device_id to prevent duplicate keys
        if (
          !entry.tempReadings.some(
            (r: SensorReading) => r.deviceId === sensor.device_id,
          )
        ) {
          entry.tempReadings.push({
            time,
            value,
            deviceId: sensor.device_id,
            deviceName: sensor.device_name,
            color: sensor.color,
          });
        }
      });

      sensor.humidity_data.forEach(({ time, value }) => {
        const timeKey = time.getTime();
        if (!timeMap.has(timeKey)) {
          timeMap.set(timeKey, {
            time,
            tempReadings: [],
            humidityReadings: [],
          });
        }
        const entry = timeMap.get(timeKey);
        // Deduplicate by device_id to prevent duplicate keys
        if (
          !entry.humidityReadings.some(
            (r: SensorReading) => r.deviceId === sensor.device_id,
          )
        ) {
          entry.humidityReadings.push({
            time,
            value,
            deviceId: sensor.device_id,
            deviceName: sensor.device_name,
            color: sensor.color,
          });
        }
      });
    });

    return Array.from(timeMap.values()).sort(
      (a, b) => a.time.getTime() - b.time.getTime(),
    );
  }, [sensorData, sensorFilter]);

  const activeSensor = sensorData.find((s) => s.device_id === activeSensorId);

  const tempStats = useMemo(
    () =>
      activeSensor ? calculateTemperatureStats(activeSensor.temp_data) : null,
    [activeSensor],
  );

  const humidityStats = useMemo(
    () =>
      activeSensor ? calculateHumidityStats(activeSensor.humidity_data) : null,
    [activeSensor],
  );

  // Calculate overall statistics for filtered sensors using latest data points
  const overallStats = useMemo(() => {
    const filteredSensors = sensorData.filter((sensor) =>
      sensorFilter === 'indoor' ? sensor.is_indoor : !sensor.is_indoor,
    );

    // Get latest temperature values with sensor info
    const latestTempData = filteredSensors
      .filter(
        (sensor) =>
          sensor.latest_temp !== undefined &&
          !isOffline(sensor.latest_temp_time),
      )
      .map((sensor) => ({
        time: sensor.latest_temp_time!,
        value: sensor.latest_temp!,
        deviceId: sensor.device_id,
        deviceName: sensor.device_name,
      }));

    // Get latest humidity values with sensor info
    const latestHumidityData = filteredSensors
      .filter(
        (sensor) =>
          sensor.latest_humidity !== undefined &&
          !isOffline(sensor.latest_humidity_time),
      )
      .map((sensor) => ({
        time: sensor.latest_humidity_time!,
        value: sensor.latest_humidity!,
        deviceId: sensor.device_id,
        deviceName: sensor.device_name,
      }));

    // Calculate stats with sensor info
    const tempStats =
      latestTempData.length > 0
        ? {
            ...calculateTemperatureStats(latestTempData),
            minSensor: latestTempData.reduce((min, curr) =>
              curr.value < min.value ? curr : min,
            ),
            maxSensor: latestTempData.reduce((max, curr) =>
              curr.value > max.value ? curr : max,
            ),
          }
        : null;

    const humidityStats =
      latestHumidityData.length > 0
        ? {
            ...calculateHumidityStats(latestHumidityData),
            minSensor: latestHumidityData.reduce((min, curr) =>
              curr.value < min.value ? curr : min,
            ),
            maxSensor: latestHumidityData.reduce((max, curr) =>
              curr.value > max.value ? curr : max,
            ),
          }
        : null;

    return {
      temp: tempStats,
      humidity: humidityStats,
    };
  }, [sensorData, sensorFilter]);

  useTimeout(
    () => {
      setDetailsModalOpen(false);
    },
    detailsModalOpen && isIdle ? 10 * 1000 : null,
  );

  const handleSensorClick = (sensorId: string) => {
    setActiveSensorId(sensorId);
    setViewMode('individual');
    setDetailsModalOpen(true);
  };

  const handleViewAllClick = () => {
    setViewMode('combined');
    setDetailsModalOpen(true);
  };

  const handleBackToIndividual = () => {
    setViewMode('individual');
  };

  return (
    <>
      <Card compact className="col-span-2 bg-base-300 overflow-hidden">
        <Card.Body className="p-3">
          {/* Horizontal scrollable sensor list */}
          <div className="flex gap-2 overflow-x-auto pb-2 h-full">
            {sensorData.map((sensor) => (
              <SensorCard
                key={sensor.device_id}
                sensor={sensor}
                onClick={() => handleSensorClick(sensor.device_id)}
              />
            ))}
          </div>
        </Card.Body>
      </Card>

      <Modal.Legacy
        open={detailsModalOpen}
        onClickBackdrop={toggleDetailsModal}
        responsive
        className="pt-0"
      >
        <Modal.Header className="sticky w-auto top-0 p-6 m-0 -mx-6 bg-base-100 bg-opacity-75 backdrop-blur-sm z-50">
          <div className="flex items-center justify-between font-bold">
            <div className="flex items-center gap-2">
              {viewMode === 'combined' && (
                <Button
                  size="sm"
                  color="ghost"
                  onClick={handleBackToIndividual}
                  className="p-1"
                >
                  <ChevronLeft size={20} />
                </Button>
              )}
              <div>
                {viewMode === 'individual' ? (
                  <>
                    <h3 className="text-lg">{activeSensor?.device_name}</h3>
                    <div className="flex gap-4 mt-2 text-sm font-normal">
                      {typeof activeSensor?.latest_temp === 'number' &&
                        !isOffline(activeSensor.latest_temp_time) && (
                          <div className="flex items-center gap-1">
                            <Thermometer size={16} />
                            <span
                              style={{
                                color: getTemperatureColor(
                                  activeSensor.latest_temp,
                                ),
                              }}
                            >
                              {activeSensor.latest_temp.toFixed(1)}°C
                            </span>
                            {tempStats && (
                              <span
                                style={{
                                  color: getTrendColor(tempStats.trend, true),
                                }}
                              >
                                {getTrendIcon(tempStats.trend)}
                              </span>
                            )}
                          </div>
                        )}
                      {typeof activeSensor?.latest_humidity === 'number' &&
                        !isOffline(activeSensor.latest_humidity_time) && (
                          <div className="flex items-center gap-1">
                            <Droplets size={16} />
                            <span
                              style={{
                                color: getHumidityColor(
                                  activeSensor.latest_humidity,
                                ),
                              }}
                            >
                              {activeSensor.latest_humidity.toFixed(1)}%
                            </span>
                            {humidityStats && (
                              <span
                                style={{
                                  color: getTrendColor(
                                    humidityStats.trend,
                                    false,
                                  ),
                                }}
                              >
                                {getTrendIcon(humidityStats.trend)}
                              </span>
                            )}
                          </div>
                        )}
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg">
                      {sensorFilter === 'indoor' ? 'Indoor' : 'Outdoor'} sensors
                    </h3>
                    <div className="flex gap-4 mt-2 text-sm font-normal">
                      <div className="flex items-center gap-1">
                        <Thermometer size={16} />
                        <span>
                          {overallStats.temp ? (
                            <>
                              <Tooltip
                                content={`Min: ${overallStats.temp.minSensor?.deviceName}`}
                                position="top"
                              >
                                <span
                                  className="cursor-help"
                                  style={{
                                    color: getTemperatureColor(
                                      overallStats.temp.min!,
                                    ),
                                  }}
                                >
                                  {formatStatValue(
                                    overallStats.temp.min!,
                                    '°C',
                                  )}
                                </span>
                              </Tooltip>
                              {' - '}
                              <Tooltip
                                content={`Max: ${overallStats.temp.maxSensor?.deviceName}`}
                                position="top"
                              >
                                <span
                                  className="cursor-help"
                                  style={{
                                    color: getTemperatureColor(
                                      overallStats.temp.max!,
                                    ),
                                  }}
                                >
                                  {formatStatValue(
                                    overallStats.temp.max!,
                                    '°C',
                                  )}
                                </span>
                              </Tooltip>
                            </>
                          ) : (
                            'No temp data'
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Droplets size={16} />
                        <span>
                          {overallStats.humidity ? (
                            <>
                              <Tooltip
                                content={`Min: ${overallStats.humidity.minSensor?.deviceName}`}
                                position="top"
                              >
                                <span
                                  className="cursor-help"
                                  style={{
                                    color: getHumidityColor(
                                      overallStats.humidity.min!,
                                    ),
                                  }}
                                >
                                  {formatStatValue(
                                    overallStats.humidity.min!,
                                    '%',
                                    0,
                                  )}
                                </span>
                              </Tooltip>
                              {' - '}
                              <Tooltip
                                content={`Max: ${overallStats.humidity.maxSensor?.deviceName}`}
                                position="top"
                              >
                                <span
                                  className="cursor-help"
                                  style={{
                                    color: getHumidityColor(
                                      overallStats.humidity.max!,
                                    ),
                                  }}
                                >
                                  {formatStatValue(
                                    overallStats.humidity.max!,
                                    '%',
                                    0,
                                  )}
                                </span>
                              </Tooltip>
                            </>
                          ) : (
                            'No humidity data'
                          )}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {viewMode === 'individual' && (
                <Button
                  size="sm"
                  color="ghost"
                  onClick={() => setViewMode('combined')}
                >
                  View All
                </Button>
              )}
              <Button onClick={toggleDetailsModal} variant="outline">
                <X />
              </Button>
            </div>
          </div>

          {/* Filter Controls */}
          {viewMode === 'combined' && (
            <div className="flex justify-center gap-2 relative z-10 pt-4">
              <div className="join">
                <Button
                  size="sm"
                  className={`join-item ${
                    sensorFilter === 'indoor' ? 'btn-active' : ''
                  }`}
                  onClick={() => setSensorFilter('indoor')}
                >
                  Indoor
                </Button>
                <Button
                  size="sm"
                  className={`join-item ${
                    sensorFilter === 'outdoor' ? 'btn-active' : ''
                  }`}
                  onClick={() => setSensorFilter('outdoor')}
                >
                  Outdoor
                </Button>
              </div>
            </div>
          )}
        </Modal.Header>

        <Modal.Body className="flex flex-col gap-4 relative">
          {viewMode === 'individual' ? (
            <>
              {/* Individual sensor statistics */}
              {(tempStats || humidityStats) && (
                <div className="grid grid-cols-2 gap-4">
                  {tempStats && (
                    <div className="bg-base-200 rounded-lg p-3">
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                        <Thermometer size={16} />
                        Temperature
                      </h4>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>Current:</span>
                          <span
                            className="font-mono"
                            style={{
                              color: getTemperatureColor(
                                tempStats.current || 0,
                              ),
                            }}
                          >
                            {formatStatValue(tempStats.current || 0, '°C')}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Min:</span>
                          <Tooltip
                            content={`Recorded at ${tempStats.minTime?.toLocaleString()}`}
                            position="top"
                          >
                            <span
                              className="font-mono cursor-help"
                              style={{
                                color: getTemperatureColor(tempStats.min),
                              }}
                            >
                              {formatStatValue(tempStats.min, '°C')}
                            </span>
                          </Tooltip>
                        </div>
                        <div className="flex justify-between">
                          <span>Max:</span>
                          <Tooltip
                            content={`Recorded at ${tempStats.maxTime?.toLocaleString()}`}
                            position="top"
                          >
                            <span
                              className="font-mono cursor-help"
                              style={{
                                color: getTemperatureColor(tempStats.max),
                              }}
                            >
                              {formatStatValue(tempStats.max, '°C')}
                            </span>
                          </Tooltip>
                        </div>
                        <div className="flex justify-between">
                          <span>Average:</span>
                          <span
                            className="font-mono"
                            style={{
                              color: getTemperatureColor(tempStats.avg),
                            }}
                          >
                            {formatStatValue(tempStats.avg, '°C')}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {humidityStats && (
                    <div className="bg-base-200 rounded-lg p-3">
                      <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                        <Droplets size={16} />
                        Humidity
                      </h4>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span>Current:</span>
                          <span
                            className="font-mono"
                            style={{
                              color: getHumidityColor(
                                humidityStats.current || 0,
                              ),
                            }}
                          >
                            {formatStatValue(
                              humidityStats.current || 0,
                              '%',
                              0,
                            )}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Min:</span>
                          <Tooltip
                            content={`Recorded at ${humidityStats.minTime?.toLocaleString()}`}
                            position="top"
                          >
                            <span
                              className="font-mono cursor-help"
                              style={{
                                color: getHumidityColor(humidityStats.min),
                              }}
                            >
                              {formatStatValue(humidityStats.min, '%', 0)}
                            </span>
                          </Tooltip>
                        </div>
                        <div className="flex justify-between">
                          <span>Max:</span>
                          <Tooltip
                            content={`Recorded at ${humidityStats.maxTime?.toLocaleString()}`}
                            position="top"
                          >
                            <span
                              className="font-mono cursor-help"
                              style={{
                                color: getHumidityColor(humidityStats.max),
                              }}
                            >
                              {formatStatValue(humidityStats.max, '%', 0)}
                            </span>
                          </Tooltip>
                        </div>
                        <div className="flex justify-between">
                          <span>Average:</span>
                          <span
                            className="font-mono"
                            style={{
                              color: getHumidityColor(humidityStats.avg),
                            }}
                          >
                            {formatStatValue(humidityStats.avg, '%', 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Individual sensor chart */}
              {individualChartData.length > 0 ? (
                <ResponsiveChart height={350} className="rounded-lg">
                  {({ width, height }) => (
                    <SensorChart
                      data={individualChartData}
                      width={width}
                      height={height}
                      animate={true}
                      showTemperature={!!tempStats}
                      showHumidity={!!humidityStats}
                    />
                  )}
                </ResponsiveChart>
              ) : (
                <div className="p-8 text-stone-500 text-center">
                  <div className="text-4xl mb-2">📡</div>
                  <div>Sensor offline</div>
                  <div className="text-sm mt-1 text-stone-600">
                    No data available
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Combined sensors statistics */}
              <div className="grid grid-cols-2 gap-4">
                {overallStats.temp && (
                  <div className="bg-base-200 rounded-lg p-3">
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2 justify-center">
                      <Thermometer size={16} />
                      {sensorFilter === 'indoor' ? 'Indoor' : 'Outdoor'}{' '}
                      Temperature
                    </h4>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span>
                          Min ({overallStats.temp.minSensor?.deviceName}):
                        </span>
                        <Tooltip
                          content={`Latest reading from ${overallStats.temp.minSensor?.deviceName}`}
                          position="top"
                        >
                          <span
                            className="font-mono cursor-help"
                            style={{
                              color: getTemperatureColor(
                                overallStats.temp.min!,
                              ),
                            }}
                          >
                            {formatStatValue(overallStats.temp.min!, '°C')}
                          </span>
                        </Tooltip>
                      </div>
                      <div className="flex justify-between">
                        <span>
                          Max ({overallStats.temp.maxSensor?.deviceName}):
                        </span>
                        <Tooltip
                          content={`Latest reading from ${overallStats.temp.maxSensor?.deviceName}`}
                          position="top"
                        >
                          <span
                            className="font-mono cursor-help"
                            style={{
                              color: getTemperatureColor(
                                overallStats.temp.max!,
                              ),
                            }}
                          >
                            {formatStatValue(overallStats.temp.max!, '°C')}
                          </span>
                        </Tooltip>
                      </div>
                      <div className="flex justify-between">
                        <span>Average:</span>
                        <span
                          className="font-mono"
                          style={{
                            color: getTemperatureColor(overallStats.temp.avg!),
                          }}
                        >
                          {formatStatValue(overallStats.temp.avg!, '°C')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sensors:</span>
                        <span className="font-mono">
                          {
                            sensorData.filter(
                              (s) =>
                                s.temp_data.length > 0 &&
                                (sensorFilter === 'indoor'
                                  ? s.is_indoor
                                  : !s.is_indoor),
                            ).length
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {overallStats.humidity && (
                  <div className="bg-base-200 rounded-lg p-3">
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2 justify-center">
                      <Droplets size={16} />
                      {sensorFilter === 'indoor' ? 'Indoor' : 'Outdoor'}{' '}
                      Humidity
                    </h4>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span>
                          Min ({overallStats.humidity.minSensor?.deviceName}):
                        </span>
                        <Tooltip
                          content={`Latest reading from ${overallStats.humidity.minSensor?.deviceName}`}
                          position="top"
                        >
                          <span
                            className="font-mono cursor-help"
                            style={{
                              color: getHumidityColor(
                                overallStats.humidity.min!,
                              ),
                            }}
                          >
                            {formatStatValue(
                              overallStats.humidity.min!,
                              '%',
                              0,
                            )}
                          </span>
                        </Tooltip>
                      </div>
                      <div className="flex justify-between">
                        <span>
                          Max ({overallStats.humidity.maxSensor?.deviceName}):
                        </span>
                        <Tooltip
                          content={`Latest reading from ${overallStats.humidity.maxSensor?.deviceName}`}
                          position="top"
                        >
                          <span
                            className="font-mono cursor-help"
                            style={{
                              color: getHumidityColor(
                                overallStats.humidity.max!,
                              ),
                            }}
                          >
                            {formatStatValue(
                              overallStats.humidity.max!,
                              '%',
                              0,
                            )}
                          </span>
                        </Tooltip>
                      </div>
                      <div className="flex justify-between">
                        <span>Average:</span>
                        <span
                          className="font-mono"
                          style={{
                            color: getHumidityColor(overallStats.humidity.avg!),
                          }}
                        >
                          {formatStatValue(overallStats.humidity.avg!, '%', 0)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sensors:</span>
                        <span className="font-mono">
                          {
                            sensorData.filter(
                              (s) =>
                                s.humidity_data.length > 0 &&
                                (sensorFilter === 'indoor'
                                  ? s.is_indoor
                                  : !s.is_indoor),
                            ).length
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Temperature Chart */}
              <div className="space-y-4">
                <div>
                  <h5 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Thermometer size={16} />
                    Temperature
                  </h5>
                  {combinedChartData.length > 0 &&
                  combinedChartData.some((d) => d.tempReadings.length > 0) ? (
                    <ResponsiveChart height={300} className="rounded-lg">
                      {({ width, height }) => (
                        <CombinedSensorsChart
                          key={`temp-chart-${sensorFilter}`}
                          data={combinedChartData}
                          width={width}
                          height={height}
                          animate={true}
                          showTemperature={true}
                          showHumidity={false}
                          sensorFilter={sensorFilter}
                          onSensorFilterChange={setSensorFilter}
                          chartType="temperature"
                          chartId="temperature"
                        />
                      )}
                    </ResponsiveChart>
                  ) : (
                    <div className="p-8 text-stone-500 text-center bg-base-200 rounded-lg">
                      <div className="text-4xl mb-2">📡</div>
                      <div>No temperature data</div>
                      <div className="text-sm mt-1 text-stone-600">
                        No recent data available from any {sensorFilter} sensors
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <h5 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Droplets size={16} />
                    Humidity
                  </h5>
                  {combinedChartData.some(
                    (d) => d.humidityReadings.length > 0,
                  ) ? (
                    <ResponsiveChart height={300} className="rounded-lg">
                      {({ width, height }) => (
                        <CombinedSensorsChart
                          key={`humidity-chart-${sensorFilter}`}
                          data={combinedChartData}
                          width={width}
                          height={height}
                          animate={true}
                          showTemperature={false}
                          showHumidity={true}
                          sensorFilter={sensorFilter}
                          onSensorFilterChange={setSensorFilter}
                          chartType="humidity"
                          chartId="humidity"
                        />
                      )}
                    </ResponsiveChart>
                  ) : (
                    <div className="p-8 text-stone-500 text-center bg-base-200 rounded-lg">
                      <div className="text-4xl mb-2">📡</div>
                      <div>No humidity data</div>
                      <div className="text-sm mt-1 text-stone-600">
                        No recent data available from any {sensorFilter} sensors
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Legends removed as requested */}
        </Modal.Body>
      </Modal.Legacy>
    </>
  );
};
