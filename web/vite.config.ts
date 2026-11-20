import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { handle } from "../proxy/src/proxy";

/**
 * In development, serves the git proxy (proxy/src/proxy.ts, the same code as
 * the Cloudflare Worker) at /git-proxy, so pasted repositories work locally.
 */
function gitProxy(): Plugin {
  const serve: Plugin["configureServer"] = (server) => {
    server.middlewares.use("/git-proxy", async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      headers.delete("origin");
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers,
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      });
      const response = await handle(request, { ALLOWED_ORIGINS: "*" });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (!response.body) return res.end();
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    });
  };
  return { name: "palimpsest-git-proxy", configureServer: serve, configurePreviewServer: serve as Plugin["configurePreviewServer"] };
}

export default defineConfig({
  plugins: [react(), gitProxy()],
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
