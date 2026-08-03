import path from "path";
import { defineConfig, mergeConfig } from "vite";
import baseConfig from "../../vite.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    base: "./",
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(import.meta.dirname, "index.html"),
      },
    },
  }),
);
