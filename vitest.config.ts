import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import referencePlugin from "./vite-plugin-reference";

export default defineConfig({
  plugins: [referencePlugin()],
  optimizeDeps: {
    include: ["fast-check"],
  },
  test: {
    globalSetup: ["src/test-font-setup.ts"],
    setupFiles: ["src/test-setup.ts"],
    exclude: ["server/**", "test/**", "node_modules/**"],
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] } }),
      instances: [{ browser: "chromium" }],
      headless: true,
      screenshotFailures: false,
    },
  },
});
