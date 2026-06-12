import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas is a native module; keep it external to the server bundle.
  serverExternalPackages: ["@napi-rs/canvas", "@resvg/resvg-js"],
};

export default nextConfig;
