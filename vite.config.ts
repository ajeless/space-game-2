import { defineConfig } from "vite";

// Base path strategy:
// - Default is "/" so the local Node server (which serves `dist/client` under its own origin)
//   and `vite preview` keep working without surprise.
// - GitHub Pages builds set `VITE_DEPLOY_TARGET=github-pages`, which rewrites asset URLs to
//   resolve under `https://ajeless.github.io/burn-vector/`.
const deployTarget = process.env.VITE_DEPLOY_TARGET;
const base = deployTarget === "github-pages" ? "/burn-vector/" : "/";

export default defineConfig({
  base,
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true
      }
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
