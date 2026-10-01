import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const app = import.meta.dirname;
/** The monorepo root: .env lives there, and so does packages/shared. */
const repo = path.resolve(app, "..", "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repo, "");
  // The API runs separately (pnpm dev:api or docker compose); the dev server proxies /api to it so
  // the browser sees a single origin and the session cookies work unchanged.
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:4100";
  const proxy = { "/api": { target: apiTarget, changeOrigin: false } };
  const port = Number(env.VITE_PORT || 5173);

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(app, "src"),
        "@shared": path.resolve(repo, "packages", "shared"),
      },
    },
    envDir: repo,
    root: app,
    build: {
      outDir: path.resolve(app, "dist"),
      emptyOutDir: true,
      chunkSizeWarningLimit: 900,
    },
    server: {
      port,
      strictPort: true,
      host: true,
      proxy,
      // The shared package sits outside this app, so Vite must be allowed to read it.
      fs: { strict: true, allow: [repo], deny: ["**/.*"] },
    },
    preview: { port, strictPort: true, proxy },
  };
});
