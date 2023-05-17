/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true, // Recommended for the `pages` directory, default in `app`.
  experimental: {
    // Required:
    appDir: true,
    esmExternals: true,
  },
  publicRuntimeConfig: {
    wsEndpoint: process.env.WS_ENDPOINT,
    weatherApiUrl: process.env.WEATHER_API_URL,
  },
};

module.exports = nextConfig;
