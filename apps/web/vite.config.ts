import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // bind 0.0.0.0 so it's reachable inside a container
    proxy: {
      "/api": { target: process.env.API_TARGET ?? "http://localhost:3001", rewrite: (p) => p.replace(/^\/api/, "") },
      // Public, same-origin routes (customer portal + token endpoints) so the
      // "Banco del Futuro" page and its /apply calls work through the dev server.
      "/banco": { target: process.env.API_TARGET ?? "http://localhost:3001" },
      "/apply": { target: process.env.API_TARGET ?? "http://localhost:3001" },
      "/hooks": { target: process.env.API_TARGET ?? "http://localhost:3001" },
      "/callbacks": { target: process.env.API_TARGET ?? "http://localhost:3001" },
    },
  },
});
