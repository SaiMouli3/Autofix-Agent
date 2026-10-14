import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/web", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom", "react-router-dom"], query: ["@tanstack/react-query"] },
      },
    },
  },
});
