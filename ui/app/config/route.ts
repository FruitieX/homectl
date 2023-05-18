export type Config = {
  wsEndpoint: string;
  weatherApiUrl: string;
};

export async function GET() {
  return new Response(
    JSON.stringify({
      wsEndpoint: process.env.WS_ENDPOINT,
      weatherApiUrl: process.env.WEATHER_API_URL,
    } as Config),
  );
}
