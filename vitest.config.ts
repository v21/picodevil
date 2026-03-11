import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import referencePlugin from "./vite-plugin-reference";

export default defineConfig({
  plugins: [referencePlugin()],
  test: {
    exclude: ["server/**", "test/**", "node_modules/**"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      headless: true,
      screenshotFailures: false,
    },
  },
});
