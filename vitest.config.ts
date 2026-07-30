import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import referencePlugin from "./vite-plugin-reference";

export default defineConfig({
  plugins: [referencePlugin()],
  optimizeDeps: {
    include: ["fast-check"],
    exclude: ["harfbuzzjs"],
  },
  test: {
    globalSetup: ["src/test-font-setup.ts"],
    setupFiles: ["src/test-setup.ts"],
    // Unit tests live in src/*.test.ts. Anchor the include at src/ rather than
    // relying on the default "everything, minus exclusions" — a git worktree under
    // .claude/ brings its own node_modules, and those ship test suites (Strudel,
    // fraction.js) that then run as if they were ours, inflating the counts and
    // reporting failures in third-party code.
    include: ["src/**/*.test.ts"],
    // Belt and braces. Note the leading **/: vitest REPLACES its default exclude
    // list when you provide one, and unprefixed "node_modules/**" only matches at
    // the repo root, so nested node_modules were being picked up.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**", "server/**", "test/**"],
    browser: {
      enabled: true,
      provider: playwright({ launchOptions: { args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] } }),
      instances: [{ browser: "chromium" }],
      headless: true,
      screenshotFailures: false,
    },
  },
});
