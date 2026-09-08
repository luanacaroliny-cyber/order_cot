import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "/order_cot/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});
