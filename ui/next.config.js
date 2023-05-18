/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true, // Recommended for the `pages` directory, default in `app`.
  experimental: {
    // Required:
    appDir: true,
    esmExternals: true,
  },
};

module.exports = nextConfig;
