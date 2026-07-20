import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // bind 0.0.0.0 so it's reachable inside a container
    proxy: { "/api": { target: process.env.API_TARGET ?? "http://localhost:3001", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
