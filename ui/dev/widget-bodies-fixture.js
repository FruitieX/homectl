const originalFetch = window.fetch.bind(window);
const now = Date.now(),
  hour = Math.floor(now / 3600000) * 3600000;
window.fetch = (input, init) => {
  const path = String(input);
  let data;
  if (path.includes('/api/calendar'))
    data = {
      events: [
        ['Team call', 10, 40, 'Online'],
        ['Pick up groceries', 80, 110, 'Local market'],
        ['Dinner', 140, 190, 'Home'],
      ].map(([summary, start, end, location], i) => ({
        id: String(i),
        summary,
        start: new Date(now + start * 60000).toISOString(),
        end: new Date(now + end * 60000).toISOString(),
        isAllDay: false,
        location,
      })),
    };
  else if (path.includes('/api/train-schedule'))
    data = [5, 14, 27].map((m, i) => ({
      name: i === 1 ? 'P' : 'I',
      destination: 'Helsinki',
      minUntilHomeDeparture: m,
      departureFormatted: new Date(now + (m + 12) * 60000).toLocaleTimeString(
        [],
        { hour: '2-digit', minute: '2-digit' },
      ),
      departureAt: (now + (m + 12) * 60000) / 1000,
      realtime: true,
      realtimeState: 'UPDATED',
    }));
  else if (path.includes('/api/weather'))
    data = {
      properties: {
        meta: { updated_at: new Date().toISOString() },
        timeseries: Array.from({ length: 72 }, (_, i) => ({
          time: new Date(hour + i * 3600000).toISOString(),
          data: {
            instant: {
              details: {
                air_temperature: 12 + 4 * Math.sin(i / 6),
                wind_speed: 3,
                relative_humidity: 62,
                ultraviolet_index_clear_sky: 2,
              },
            },
            next_1_hours: {
              details: { precipitation_amount: 0 },
              summary: {
                symbol_code:
                  i % 5 === 0 ? 'rainshowers_day' : 'partlycloudy_day',
              },
            },
          },
        })),
      },
    };
  else if (path.includes('/api/influxdb/spot-prices'))
    data = Array.from({ length: 100 }, (_, i) => ({
      _time: new Date(hour + (i - 1) * 900000).toISOString(),
      _value: 4 + 3 * Math.sin(i / 9) + i / 30,
    }));
  else if (path.includes('/api/influxdb/temp-sensors'))
    data = ['render_living', 'render_bedroom'].flatMap((id, k) =>
      Array.from({ length: 36 }, (_, i) =>
        ['tempc', 'hum'].map((f) => ({
          device_id: id,
          integration_id: 'influxdb',
          _field: f,
          _time: new Date(now - (35 - i) * 600000).toISOString(),
          _value:
            f === 'tempc'
              ? 21 + k + Math.sin(i / 8) * 0.3
              : 45 + k + Math.cos(i / 9) * 3,
        })),
      ).flat(),
    );
  return data
    ? Promise.resolve(
        new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    : originalFetch(input, init);
};
