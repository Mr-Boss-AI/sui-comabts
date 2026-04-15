import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  turbopack: {
    root: "/home/shakalis/sui-comabts",
  },
};

export default nextConfig;
