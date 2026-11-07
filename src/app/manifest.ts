import type { MetadataRoute } from "next";

// Icon src values are not prefixed with basePath automatically.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "X și 0",
    short_name: "X și 0",
    description: "X și 0 clasic, jucat cu un prieten. Alții pot intra ca spectatori.",
    id: `${BASE}/`,
    start_url: `${BASE}/`,
    // "/" on purpose: leaving the game for the hub (same origin) stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: `${BASE}/pwa-icon/192`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE}/pwa-icon/512`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${BASE}/pwa-icon/maskable`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
