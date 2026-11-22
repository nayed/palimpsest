import { afterEach, describe, expect, it, vi } from "vitest";
import { GitError, PktReader, concat, countCommits, encodeRequest, fetchPack, lsRefs } from "./smartHttp";

const enc = new TextEncoder();
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const pkt = (s: string | Uint8Array) => {
  const body = typeof s === "string" ? enc.encode(s) : s;
  return concat([enc.encode((body.length + 4).toString(16).padStart(4, "0")), body]);
};

afterEach(() => vi.unstubAllGlobals());

/** Answers git requests with `body`, in chunks of `size` bytes. */
function serve(body: Uint8Array, status = 200, size = 7) {
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
    calls.push(init);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < body.length; i += size) c.enqueue(body.slice(i, i + size));
        c.close();
      },
    });
    return new Response(stream, { status });
  });
  return calls;
}

describe("pkt-lines", () => {
  it("encodes requests", () => {
    expect(text(encodeRequest(["command=ls-refs", "delim", "symrefs", "flush"]))).toBe(
      "0014command=ls-refs\n0001000csymrefs\n0000",
    );
  });

  it("splits a stream at any chunk boundary", () => {
    const stream = concat([pkt("abc"), enc.encode("0000"), pkt("de")]);
    for (let size = 1; size <= stream.length; size++) {
      const r = new PktReader();
      const got = [];
      for (let i = 0; i < stream.length; i += size) got.push(...r.push(stream.slice(i, i + size)));
      expect(got.map((p) => (p.kind === "data" ? text(p.data) : p.kind))).toEqual(["abc", "flush", "de"]);
    }
  });
});

describe("talking to GitHub", () => {
  it("finds the head of the default branch", async () => {
    const head = "43fc97d43a4c61d65e7d74d4110c8480fe42ea5b";
    const calls = serve(concat([pkt(`${head} HEAD symref-target:refs/heads/master\n`), enc.encode("0000")]));
    expect(await lsRefs("/git-proxy", "BurntSushi/ripgrep")).toEqual({ head, ref: "refs/heads/master", tags: [] });
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1]!.headers).get("Git-Protocol")).toBe("version=2");
  });

  it("lists tags with the commits they point to", async () => {
    const [head, tagObject, commit, light] = ["a", "b", "c", "d"].map((c) => c.repeat(40));
    const calls = serve(
      concat([
        pkt(`${head} HEAD symref-target:refs/heads/main\n`),
        pkt(`${tagObject} refs/tags/v1.0.0 peeled:${commit}\n`),
        pkt(`${light} refs/tags/0.9\n`),
        enc.encode("0000"),
      ]),
    );
    const refs = await lsRefs("/p", "a/b");
    expect(refs.tags).toEqual([
      { name: "v1.0.0", commit },
      { name: "0.9", commit: light },
    ]);
    const body = text(calls[1]!.body as Uint8Array);
    expect(body).toContain("ref-prefix refs/tags/");
    expect(body).toContain("peel");
  });

  it("asks for several commits short of what it has", async () => {
    const calls = serve(concat([pkt("packfile\n"), pkt(concat([Uint8Array.of(1), enc.encode("PACK")])), enc.encode("0000")]));
    await fetchPack("/p", "a/b", ["1".repeat(40), "2".repeat(40)], { filter: "tree:0", haves: ["3".repeat(40)] });
    const body = text(calls[0]!.body as Uint8Array);
    expect(body).toContain(`want ${"1".repeat(40)}`);
    expect(body).toContain(`want ${"2".repeat(40)}`);
    expect(body).toContain(`have ${"3".repeat(40)}`);
  });

  it("keeps only the pack from the side band", async () => {
    const body = concat([
      pkt("packfile\n"),
      pkt(concat([Uint8Array.of(2), enc.encode("Counting objects\n")])),
      pkt(concat([Uint8Array.of(1), enc.encode("PACK1")])),
      pkt(concat([Uint8Array.of(1), enc.encode("234")])),
      enc.encode("0000"),
    ]);
    serve(body);
    const seen: number[] = [];
    const pack = await fetchPack("/p", "a/b", "f".repeat(40), { filter: "tree:0", onBytes: (n) => seen.push(n) });
    expect(text(pack)).toBe("PACK1234");
    expect(seen[seen.length - 1]).toBe(body.length);
  });

  it("counts commits from a pack header alone", async () => {
    const header = Uint8Array.of(...enc.encode("PACK"), 0, 0, 0, 2, 0, 5, 0x54, 0x70);
    serve(concat([pkt("packfile\n"), pkt(concat([Uint8Array.of(1), header, enc.encode("more pack data")]))]));
    expect(await countCommits("/p", "rust-lang/rust", "f".repeat(40))).toBe(349_296);
  });

  it("reports a private or missing repository", async () => {
    serve(new Uint8Array(), 401);
    await expect(lsRefs("/p", "no/such")).rejects.toMatchObject({ kind: "notFound" });
  });

  it("reports errors sent in the pack stream", async () => {
    serve(concat([pkt("packfile\n"), pkt(concat([Uint8Array.of(3), enc.encode("upload-pack: not our ref")]))]));
    const err = await fetchPack("/p", "a/b", "0".repeat(40)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect((err as GitError).message).toContain("not our ref");
  });
});
