import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/internal/preview/evidence-replay": ["./tests/fixtures/journey-parity/*.json.gz"],
  },
};
export default nextConfig;
