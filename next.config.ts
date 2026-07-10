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
    ];
  },
};

export default nextConfig;
