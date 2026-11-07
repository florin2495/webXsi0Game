import type { NextConfig } from "next";
import pkg from "./package.json";

// Served at games.hailatat.icu/tictactoe (the hub proxies this path here; Next.js multi-zones).
const BASE_PATH = "/tictactoe";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  // Shown next to "Setări". Bump package.json "version" (patch) on every push to main.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
