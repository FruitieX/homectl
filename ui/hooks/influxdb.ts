'use client';

import { useEffect, useState } from 'react';
import { useInterval } from 'usehooks-ts';

interface TempSensorRow {
  device_id: string;
  integration_id: string;
  _time: Date;
  _value: number;
}

export const useTempSensorsQuery = () => {
  const [tempSensors, setTempSensors] = useState<TempSensorRow[]>([]);

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      try {
        const res = await fetch('/api/influxdb/temp-sensors');
        if (!res.ok) {
          throw new Error(`Failed to fetch temp sensors: ${res.status}`);
        }
        const data: TempSensorRow[] = await res.json();
        if (isSubscribed) {
          setTempSensors(data);
        }
      } catch (error) {
        console.error('Error fetching temp sensors:', error);
      }
    };

    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, []);

  useInterval(async () => {
    try {
      const res = await fetch('/api/influxdb/temp-sensors');
      if (!res.ok) {
        throw new Error(`Failed to fetch temp sensors: ${res.status}`);
      }
      const data: TempSensorRow[] = await res.json();
      setTempSensors(data);
    } catch (error) {
      console.error('Error fetching temp sensors:', error);
    }
  }, 60 * 1000);

  return tempSensors;
};

interface SpotPriceRow {
  _time: Date;
  _value: number;
}

export const useSpotPriceQuery = () => {
  const [spotPrices, setSpotPrices] = useState<SpotPriceRow[]>([]);

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      try {
        const res = await fetch('/api/influxdb/spot-prices');
        if (!res.ok) {
          throw new Error(`Failed to fetch spot prices: ${res.status}`);
        }
        const data: SpotPriceRow[] = await res.json();
        if (isSubscribed) {
          setSpotPrices(data);
        }
      } catch (error) {
        console.error('Error fetching spot prices:', error);
      }
    };

    fetchData();

    return () => {
      isSubscribed = false;
    };
  }, []);

  useInterval(async () => {
    try {
      const res = await fetch('/api/influxdb/spot-prices');
      if (!res.ok) {
        throw new Error(`Failed to fetch spot prices: ${res.status}`);
      }
      const data: SpotPriceRow[] = await res.json();
      setSpotPrices(data);
    } catch (error) {
      console.error('Error fetching spot prices:', error);
    }
  }, 60 * 1000);

  return spotPrices;
};
