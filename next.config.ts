import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // عميل libSQL يعتمد على Node APIs — يُستثنى من التجميع
  serverExternalPackages: ["@libsql/client"],
  reactStrictMode: false,
};

export default nextConfig;
