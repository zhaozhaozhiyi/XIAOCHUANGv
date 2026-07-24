import type { NextConfig } from "next";

if (process.env.NODE_ENV === "production" && !process.env.BACKEND_BASE_URL?.trim()) {
  throw new Error("BACKEND_BASE_URL is required for apps/admin production builds.");
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
