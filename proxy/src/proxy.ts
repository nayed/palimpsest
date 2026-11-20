// The only server-side piece of Palimpsest: a Cloudflare Worker that lets the
// browser read public GitHub repositories. GitHub does not allow cross-origin
// git requests, so this forwards git's smart-HTTP read requests, and nothing
// else, to github.com:
//
//   GET  /<owner>/<repo>.git/info/refs?service=git-upload-pack
//   POST /<owner>/<repo>.git/git-upload-pack
//
// Anything else is refused, so it cannot be used as an open proxy.

export interface Env {
  /** Comma-separated origins allowed to call the proxy, or "*". */
  ALLOWED_ORIGINS: string;
}

const PATH = /^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/(info\/refs|git-upload-pack)$/;
const UPLOAD_PACK_REQUEST = "application/x-git-upload-pack-request";
/** Requests are a few lines of wants; a large body is not a git client. */
const MAX_REQUEST_BYTES = 64 * 1024;

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("Origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.includes("*")) return origin ?? "*";
  return origin && allowed.includes(origin) ? origin : null;
}

function cors(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Git-Protocol",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function refuse(status: number, message: string, origin: string | null): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain", ...cors(origin) } });
}

export async function handle(request: Request, env: Env, upstream: typeof fetch = fetch): Promise<Response> {
  const origin = allowedOrigin(request, env);
  if (request.headers.get("Origin") && !origin) return refuse(403, "Origin not allowed", null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

  const url = new URL(request.url);
  const m = PATH.exec(url.pathname);
  if (!m) return refuse(404, "Not a git read request", origin);
  const [, owner, repo, endpoint] = m;

  if (endpoint === "info/refs") {
    if (request.method !== "GET") return refuse(405, "Method not allowed", origin);
    if (url.search !== "?service=git-upload-pack") return refuse(400, "Only git-upload-pack is served", origin);
  } else {
    if (request.method !== "POST") return refuse(405, "Method not allowed", origin);
    if (request.headers.get("Content-Type") !== UPLOAD_PACK_REQUEST) return refuse(415, "Not a git request", origin);
    if (Number(request.headers.get("Content-Length") ?? 0) > MAX_REQUEST_BYTES) return refuse(413, "Request too large", origin);
  }

  const headers = new Headers({ "User-Agent": "git/2.0 (palimpsest)" });
  for (const name of ["Content-Type", "Git-Protocol", "Accept"]) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_REQUEST_BYTES) return refuse(413, "Request too large", origin);
  }

  const target = `https://github.com/${owner}/${repo}.git/${endpoint}${url.search}`;
  let res: Response;
  try {
    res = await upstream(target, { method: request.method, headers, body, redirect: "manual" });
  } catch {
    return refuse(502, "Could not reach GitHub", origin);
  }

  // A renamed repository redirects; follow it only within github.com.
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("Location");
    const next = location ? new URL(location, target) : null;
    if (!next || next.hostname !== "github.com") return refuse(502, "Unexpected redirect", origin);
    try {
      res = await upstream(next.toString(), { method: request.method, headers, body, redirect: "manual" });
    } catch {
      return refuse(502, "Could not reach GitHub", origin);
    }
  }

  // Keep only what a git client needs. In particular, drop WWW-Authenticate:
  // GitHub answers 401 for private or missing repositories, and passing the
  // header on would make the browser pop up a password prompt.
  const out = new Headers(cors(origin));
  const type = res.headers.get("Content-Type");
  if (type) out.set("Content-Type", type);
  out.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers: out });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
