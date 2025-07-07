export type Config = {
  wsEndpoint: string;
  weatherApiUrl: string;
  trainApiUrl: string;
  influxUrl: string;
  influxToken: string;
  calendarApiUrl: string;
  calendarIcsUrl: string;
};

export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(
    JSON.stringify({
      wsEndpoint: process.env.WS_ENDPOINT,
      weatherApiUrl: process.env.WEATHER_API_URL,
      trainApiUrl: process.env.TRAIN_API_URL,
      influxUrl: process.env.INFLUX_URL,
      influxToken: process.env.INFLUX_TOKEN,
      calendarApiUrl: process.env.CALENDAR_API_URL || '/api/calendar',
      calendarIcsUrl: process.env.GOOGLE_CALENDAR_ICS_URL || '',
    } as Config),
  );
}
