import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3847",
      "/health": "http://127.0.0.1:3847",
      "/mcp": "http://127.0.0.1:3847",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
