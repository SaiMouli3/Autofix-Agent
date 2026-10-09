import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = process.env.SCA_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/healthz": api,
      "/readyz": api,
    },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
});
