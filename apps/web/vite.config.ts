import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

const app = import.meta.dirname;
/** The monorepo root: .env lives there, and so does packages/shared. */
const repo = path.resolve(app, "..", "..");

/**
 * pdf.js loads some data on demand: the standard fonts, colour profiles, and the decoders that
 * scanned pages need. This publishes those files at /pdfjs/ (served in dev, copied into the build)
 * so a signing page never depends on a third-party host.
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const folders = ["wasm", "standard_fonts", "iccs", "cmaps"];
  const walk = (dir: string): string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap(entry =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : [path.join(dir, entry.name)]
      );
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (request, response, next) => {
        const relative = decodeURIComponent((request.url ?? "").split("?")[0]);
        const file = path.normalize(path.join(root, relative));
        const allowed = folders.some(folder =>
          file.startsWith(path.join(root, folder) + path.sep)
        );
        if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile())
          return next();
        response.setHeader(
          "Content-Type",
          file.endsWith(".wasm")
            ? "application/wasm"
            : "application/octet-stream"
        );
        fs.createReadStream(file).pipe(response);
      });
    },
    generateBundle() {
      for (const folder of folders)
        for (const file of walk(path.join(root, folder)))
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${path.relative(root, file).split(path.sep).join("/")}`,
            source: fs.readFileSync(file),
          });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repo, "");
  // The API runs separately (pnpm dev:api or docker compose); the dev server proxies /api to it so
  // the browser sees a single origin and the session cookies work unchanged.
  const apiTarget = env.VITE_API_PROXY_TARGET || "http://localhost:4100";
  const proxy = { "/api": { target: apiTarget, changeOrigin: false } };
  const port = Number(env.VITE_PORT || 5173);

  return {
    plugins: [react(), tailwindcss(), pdfjsAssets()],
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
