import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend calls the API with relative paths (apiBaseUrl=""), so we proxy
// /api and /healthz to the FastAPI backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
