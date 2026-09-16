import { defineConfig } from "vitest/config";

/**
 * The bridge needs its own config purely so Vitest stops walking up to the
 * repository root and loading the frontend's vite.config.ts — the React and
 * PWA plugins there are irrelevant here, and pulling them in made the bridge's
 * tests fail to start for reasons that had nothing to do with the bridge.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
