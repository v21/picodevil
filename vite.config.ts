import { defineConfig } from "vite";
import referencePlugin from "./vite-plugin-reference";

export default defineConfig({
  plugins: [referencePlugin()],
  optimizeDeps: {
    exclude: ['harfbuzzjs'],
  },
});
