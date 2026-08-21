import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed to Cloudflare Workers via OpenNext (@opennextjs/cloudflare).
  // No special `output` flag needed on Next 15 — OpenNext handles the build.
};

export default nextConfig;

// Enables `getCloudflareContext()` bindings (KV, rate limiter) during
// `next dev` via wrangler's local emulation.
import("@opennextjs/cloudflare").then((m) =>
  m.initOpenNextCloudflareForDev(),
);
