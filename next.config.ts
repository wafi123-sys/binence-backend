import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static HTML export for Capacitor
  output: 'export',
  // Custom server: disable built-in server
  serverExternalPackages: [],
};

export default nextConfig;
