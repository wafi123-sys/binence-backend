import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Custom server: disable built-in server
  serverExternalPackages: [],
  async rewrites() {
    return [
      {
        source: '/api/ws',
        // Proxy WebSocket to the local backend on port 3001
        destination: 'http://localhost:3001',
      },
      {
        source: '/api/binance-rest/:path*',
        destination: 'https://data-api.binance.vision/:path*',
      },
      {
        source: '/api/binance-fapi/:path*',
        destination: 'https://testnet.binancefuture.com/:path*',
      },
    ];
  },
};

export default nextConfig;
