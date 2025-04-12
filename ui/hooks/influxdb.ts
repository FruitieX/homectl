'use client';

import { atom, useAtomValue, useSetAtom } from 'jotai';
import { InfluxDB, QueryApi } from '@influxdata/influxdb-client-browser';
import { useAppConfig } from './appConfig';
import { useEffect, useState } from 'react';
import { cachedPromise } from 'app/dashboard/cachedPromise';
import { useInterval } from 'usehooks-ts';

const influxdbAtom = atom<InfluxDB | null>(null);

export const useProvideInfluxDb = () => {
  const appConfig = useAppConfig();
  const setInfluxdbAtom = useSetAtom(influxdbAtom);

  useEffect(() => {
    const influxDB = new InfluxDB({
      url: appConfig.influxUrl,
      token: appConfig.influxToken,
    });

    setInfluxdbAtom(influxDB);
  }, []);
};

export const useInfluxDbQueryApi = (): QueryApi | null => {
  const [state, setState] = useState<QueryApi | null>(null);
  const influxDb = useAtomValue(influxdbAtom);

  useEffect(() => {
    if (!influxDb) {
      return;
    }

    const queryApi = influxDb.getQueryApi('influxdata');
    setState(queryApi);
  }, [influxDb]);

  return state;
};

export const useCachedInfluxDbQuery = (query: string, cacheKey: string) => {
  const [state, setState] = useState<any>([]);
  const queryApi = useInfluxDbQueryApi();

  useEffect(() => {
    if (!queryApi) {
      return;
    }

    new Promise(async () => {
      const result = await cachedPromise(cacheKey, 1, async () => {
        return await queryApi.collectRows(query);
      });
      setState(result);
    });
  }, [queryApi]);

  useInterval(async () => {
    if (!queryApi) {
      console.log('InfluxDB client not initialized');
      return null;
    }

    const result = await cachedPromise(cacheKey, 1, async () => {
      return await queryApi.collectRows(query);
    });
    setState(result);
  }, 60 * 1000);

  return state;
};

interface TempSensorRow {
  device_id: string;
  integration_id: string;
  _time: Date;
  _value: number;
}

export const useTempSensorsQuery = () => {
  const tempSensors: TempSensorRow[] = useCachedInfluxDbQuery(
    `
      from(bucket: "home")
        |> range(start: -6h)
        |> filter(fn: (r) =>
            // backyard
            (r["device_id"] == "D9353438450D" and r["integration_id"] == "ble1") or

            // front yard
            (r["device_id"] == "D83534387029" and r["integration_id"] == "ble2") or 

            // patio
            (r["device_id"] == "D4343037362D" and r["integration_id"] == "ble1") or

            // living room
            (r["device_id"] == "D7353530665A" and r["integration_id"] == "ble1") or

            // car
            (r["device_id"] == "C76A0246647E" and r["integration_id"] == "ble2")
        )
        |> filter(fn: (r) => r["_field"] == "tempc")
        |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
        |> yield(name: "mean")
    `,
    'tempSensorQuery',
  );

  return tempSensors;
};

interface SpotPriceRow {
  _time: Date;
  _value: number;
}

export const useSpotPriceQuery = () => {
  const spotPrices: SpotPriceRow[] = useCachedInfluxDbQuery(
    `
      import "date"
      import "timezone"

      option location = timezone.location(name: "Europe/Helsinki")

      from(bucket: "nordpool")
        |> range(start: date.truncate(t: now(), unit: 1d), stop: 24h)
        |> filter(fn: (r) => r["_measurement"] == "price")
    `,
    'spotPriceQuery',
  );

  return spotPrices;
};
