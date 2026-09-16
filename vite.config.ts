import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      workbox: {
        // Without this, the service worker's NavigationRoute intercepts
        // every browser navigation — including /api/qbo/connect and
        // /api/qbo/callback — and serves the cached SPA shell instead of
        // ever hitting the network, so the QBO OAuth redirect silently
        // never happens. Mirrors vercel.json's own rewrite exclusion.
        navigateFallbackDenylist: [/^\/api\//, /^\/legal\//],
      },
      manifest: {
        name: "African Nomad — Job Sheets",
        short_name: "AN Job Sheets",
        description: "Job sheet, quote and invoice management for African Nomad, synced to QuickBooks.",
        theme_color: "#8a5a2b",
        background_color: "#f7f6f3",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    // One command covers the whole repository. The bridge also carries its own
    // vitest.config.ts so it can be tested standalone from bridge/ — without
    // it, Vitest walks up and loads this frontend config instead.
    include: ["src/**/*.test.ts", "bridge/src/**/*.test.ts"],
    // Unit tests cover pure calculation and mapping logic, but importing it
    // reaches lib/supabase.ts, which builds a real client at module load.
    // Vitest otherwise inherits .env.local, so that client is actually
    // constructed and @supabase/realtime-js throws on Node < 22 ("native
    // WebSocket not found"). Blanking the two variables makes
    // supabaseConfigured false, so no client is created and no test depends
    // on a developer's local environment. Nothing here affects the browser
    // build, where WebSocket always exists.
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
    },
  },
});
