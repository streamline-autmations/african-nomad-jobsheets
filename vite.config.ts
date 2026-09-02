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
  },
});
