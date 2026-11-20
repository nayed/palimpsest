import { describe, expect, it } from "vitest";
import { handle } from "../../../proxy/src/proxy";

const env = { ALLOWED_ORIGINS: "https://palimpsest.example" };
const ORIGIN = { Origin: "https://palimpsest.example" };

/** A fake GitHub that records what it was asked. */
function github(status = 200, extra: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const upstream = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("PACK", {
      status,
      headers: { "Content-Type": "application/x-git-upload-pack-result", "WWW-Authenticate": "Basic", ...extra },
    });
  }) as unknown as typeof fetch;
  return { calls, upstream };
}

const post = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://proxy.example${path}`, {
    method: "POST",
    headers: { ...ORIGIN, "Content-Type": "application/x-git-upload-pack-request", "Git-Protocol": "version=2", ...headers },
    body: "0014command=ls-refs\n0000",
  });

describe("the git proxy", () => {
  it("forwards upload-pack requests to github.com", async () => {
    const gh = github();
    const res = await handle(post("/BurntSushi/ripgrep.git/git-upload-pack"), env, gh.upstream);
    expect(res.status).toBe(200);
    expect(gh.calls[0]!.url).toBe("https://github.com/BurntSushi/ripgrep.git/git-upload-pack");
    expect(new Headers(gh.calls[0]!.init.headers).get("Git-Protocol")).toBe("version=2");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://palimpsest.example");
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    expect(await res.text()).toBe("PACK");
  });

  it("forwards the refs advertisement", async () => {
    const gh = github();
    const req = new Request("https://proxy.example/a/b/info/refs?service=git-upload-pack", { headers: ORIGIN });
    expect((await handle(req, env, gh.upstream)).status).toBe(200);
    expect(gh.calls[0]!.url).toBe("https://github.com/a/b.git/info/refs?service=git-upload-pack");
  });

  it("refuses everything else", async () => {
    const gh = github();
    const cases: [Request, number][] = [
      [new Request("https://proxy.example/a/b/git-receive-pack", { method: "POST", headers: ORIGIN }), 404],
      [new Request("https://proxy.example/a/b/info/refs?service=git-receive-pack", { headers: ORIGIN }), 400],
      [new Request("https://proxy.example/a/b/git-upload-pack", { headers: ORIGIN }), 405],
      [post("/a/b/git-upload-pack", { "Content-Type": "text/plain" }), 415],
      [new Request("https://proxy.example/https://evil.example/x", { headers: ORIGIN }), 404],
      [new Request("https://proxy.example/../../etc/passwd", { headers: ORIGIN }), 404],
      [post("/a/b/git-upload-pack", { Origin: "https://elsewhere.example" }), 403],
    ];
    for (const [req, status] of cases) expect((await handle(req, env, gh.upstream)).status, req.url).toBe(status);
    expect(gh.calls).toHaveLength(0);
  });

  it("answers preflight requests", async () => {
    const req = new Request("https://proxy.example/a/b/git-upload-pack", { method: "OPTIONS", headers: ORIGIN });
    const res = await handle(req, env, github().upstream);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Git-Protocol");
  });

  it("follows a redirect within github.com only", async () => {
    let n = 0;
    const upstream = (async (url: string) => {
      n++;
      if (n === 1) return new Response(null, { status: 301, headers: { Location: "https://github.com/new/name.git/git-upload-pack" } });
      return new Response(url);
    }) as unknown as typeof fetch;
    const res = await handle(post("/old/name/git-upload-pack"), env, upstream);
    expect(await res.text()).toBe("https://github.com/new/name.git/git-upload-pack");

    const away = (async () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } })) as unknown as typeof fetch;
    expect((await handle(post("/old/name/git-upload-pack"), env, away)).status).toBe(502);
  });

  it("passes on GitHub's status for missing repositories, without a password prompt", async () => {
    const res = await handle(post("/no/such/git-upload-pack"), env, github(401).upstream);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
  });
});
