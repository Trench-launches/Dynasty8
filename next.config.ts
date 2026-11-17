import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // This app lives inside a larger workspace; keep tracing scoped to this folder.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
