import { defineConfig } from "vite";
import referencePlugin from "./vite-plugin-reference";

export default defineConfig({
  plugins: [referencePlugin()],
  build: {
    // harfbuzzjs uses top-level await, which the default browser target
    // (es2020/chrome87/safari14) can't transpile. Raise to targets with TLA support.
    target: ["es2022", "chrome89", "edge89", "firefox89", "safari15"],
  },
  optimizeDeps: {
    exclude: ['harfbuzzjs'],
  },
});
