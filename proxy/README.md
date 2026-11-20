# Palimpsest git proxy

A Cloudflare Worker that lets the browser read public GitHub repositories.
GitHub does not allow cross-origin git requests, so this forwards git's two
read-only smart-HTTP requests, and nothing else, to github.com:

    GET  /<owner>/<repo>.git/info/refs?service=git-upload-pack
    POST /<owner>/<repo>.git/git-upload-pack

Deploy it from this folder; `ALLOWED_ORIGINS` in `wrangler.toml` lists the
site origins allowed to use it:

    ../web/node_modules/.bin/wrangler deploy

The site is built with `VITE_GIT_PROXY` set to the Worker's address
(`pnpm ship` in `web/` does both).
Tests run with the web app's (`web/src/proxy/proxy.test.ts`); in development,
Vite serves the same code at `/git-proxy`.
