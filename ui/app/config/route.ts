export type Config = {
  wsEndpoint: string;
  weatherApiUrl: string;
  trainApiUrl: string;
};

export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(
    JSON.stringify({
      wsEndpoint: process.env.WS_ENDPOINT,
      weatherApiUrl: process.env.WEATHER_API_URL,
      trainApiUrl: process.env.TRAIN_API_URL,
    } as Config),
  );
}
