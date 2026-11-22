// Pasted repositories, against recorded GitHub answers for BurntSushi/walkdir
// (e2e/fixtures), so these tests do not depend on the network.

import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";

const fixture = (name: string) => readFileSync(`e2e/fixtures/${name}`);

function pkt(data: Buffer): Buffer {
  return Buffer.concat([Buffer.from((data.length + 4).toString(16).padStart(4, "0")), data]);
}

/** A commits-only pack response whose header claims `n` commits. */
function packHeader(n: number): Buffer {
  const header = Buffer.alloc(12);
  header.write("PACK");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(n, 8);
  return Buffer.concat([pkt(Buffer.from("packfile\n")), pkt(Buffer.concat([Buffer.from([1]), header]))]);
}

/**
 * The recorded ls-refs answer with two release tags added: one on walkdir's
 * head, one on a commit the pack does not hold (as for a release branch).
 */
function lsRefsWithTags(): Buffer {
  const recorded = fixture("ls-refs.bin");
  const head = /([0-9a-f]{40}) HEAD/.exec(recorded.toString("latin1"))![1]!;
  const tags = [`${head} refs/tags/9.9.0\n`, `${"e".repeat(40)} refs/tags/9.8.0\n`].map((l) => pkt(Buffer.from(l)));
  // Before the final flush.
  return Buffer.concat([recorded.subarray(0, recorded.length - 4), ...tags, Buffer.from("0000")]);
}

/** Answers the app's git requests like GitHub would for walkdir. */
async function fakeGitHub(
  context: BrowserContext,
  opts: {
    missing?: boolean;
    commits?: number;
    slowPack?: number;
    /** Commits in the last `months`, for windows of history (deepen-since). */
    since?: (months: number) => number;
  } = {},
) {
  await context.route("**/git-proxy/**", async (route) => {
    const req = route.request();
    if (opts.missing) return route.fulfill({ status: 401, body: "" });
    if (req.method() === "GET") return route.fulfill({ status: 200, body: "" });
    const body = req.postDataBuffer()?.toString("latin1") ?? "";
    const type = "application/x-git-upload-pack-result";
    if (body.includes("command=ls-refs")) return route.fulfill({ contentType: type, body: lsRefsWithTags() });
    const since = /deepen-since (\d+)/.exec(body);
    if (since) {
      // A window of history: a count, or the recorded shallow pack (walkdir
      // since March 2021, 12 commits on the main line).
      if (!body.includes("filter tree:0")) return route.fulfill({ contentType: type, body: fixture("fetch-since.bin") });
      const months = Math.round((Date.now() / 1000 - Number(since[1])) / (30.44 * 86_400));
      return route.fulfill({ contentType: type, body: packHeader(opts.since?.(months) ?? 10) });
    }
    if (body.includes("filter tree:0")) {
      return route.fulfill({ contentType: type, body: opts.commits ? packHeader(opts.commits) : fixture("commits.bin") });
    }
    if (opts.slowPack) await new Promise((r) => setTimeout(r, opts.slowPack));
    return route.fulfill({ contentType: type, body: fixture("fetch.bin") });
  });
}

test("a pasted repository is read in the browser", async ({ page, context }) => {
  await fakeGitHub(context);
  let tagRequests = 0;
  page.on("request", (r) => {
    if ((r.postDataBuffer()?.toString("latin1") ?? "").includes(`want ${"e".repeat(40)}`)) tagRequests++;
  });
  await page.goto("/BurntSushi/walkdir");
  await expect(page.locator(".legend")).toContainText("Andrew Gallant", { timeout: 15_000 });
  await expect(page.locator(".legend")).toContainText("Colored by who was writing");
  await expect(page.locator(".commit-count")).toContainText("Commit 185 of 185");
  // The release tag on the head is placed; the one on an unknown commit was
  // asked for and, not found, left out.
  await expect(page.getByRole("slider", { name: "Playhead" })).toHaveAttribute("aria-valuetext", /release 9\.9\.0$/);
  expect(tagRequests).toBe(1);
  // The code at the playhead comes from line history worked out on demand.
  await expect(page.locator(".code-row").first()).toBeVisible();
  await page.keyboard.press("1");
  await expect(page.locator(".share-part").first()).toContainText("%", { timeout: 15_000 });
});

test("the loading screen shows progress and can stop", async ({ page, context }) => {
  await fakeGitHub(context, { slowPack: 2000 });
  await page.goto("/BurntSushi/walkdir");
  await expect(page.getByRole("button", { name: "Stop loading" })).toBeVisible();
  await expect(page.getByText("Download the repository")).toBeVisible();
  await expect(page.getByText("Nothing is loaded yet. Tracks will appear here.")).toBeVisible();
  await page.getByRole("button", { name: "Stop loading" }).click();
  await expect(page.getByRole("heading", { name: "Stopped" })).toBeVisible();
});

test("a repository over the limit is refused before downloading it", async ({ page, context }) => {
  let fullFetches = 0;
  await fakeGitHub(context, { commits: 349_296 });
  page.on("request", (r) => {
    if (r.method() === "POST" && !r.postDataBuffer()?.toString("latin1").match(/ls-refs|tree:0/)) fullFetches++;
  });
  await page.goto("/rust-lang/rust");
  await expect(page.getByRole("heading", { name: "Too big for one browser tab" })).toBeVisible();
  await expect(page.getByText("This repository has 349,296 commits.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play history" })).toBeDisabled();
  expect(fullFetches).toBe(0);
  await page.getByRole("link", { name: "Back to the demo repo" }).click();
  await expect(page.locator(".legend")).toContainText("Christian Duerr");
});

test("a repository over the limit offers recent windows, and loads one", async ({ page, context }) => {
  await fakeGitHub(context, {
    commits: 349_296,
    since: (months) => (months >= 24 ? 69_178 : months >= 12 ? 35_797 : 820),
  });
  await page.goto("/BurntSushi/walkdir");
  await expect(page.getByRole("heading", { name: "Too big for one browser tab" })).toBeVisible();
  // Two years is over the limit: the longest window that fits is a year.
  await expect(page.getByText("About 36,000 commits, back to")).toBeVisible();
  await expect(page.getByText("About 820 commits, back to")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load the last 3 months" })).toBeVisible();
  await page.getByRole("button", { name: "Load the last year" }).click();

  await expect(page).toHaveURL(/since=\d{4}-\d{2}-\d{2}/);
  // The window starts in March 2021: the code already there is drawn apart.
  await expect(page.locator(".legend")).toContainText("Before Mar 2021", { timeout: 15_000 });
  await expect(page.locator(".commit-count")).toContainText("of 12");
});

test("a repository even whose last month is over the limit is only refused", async ({ page, context }) => {
  await fakeGitHub(context, { commits: 1_400_000, since: () => 60_000 });
  await page.goto("/BurntSushi/walkdir");
  await expect(page.getByText("Even its last month has more than 50,000 commits.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Load / })).toHaveCount(0);
});

test("a private or missing repository says so", async ({ page, context }) => {
  await fakeGitHub(context, { missing: true });
  await page.goto("/example-owner/example-missing");
  await expect(page.getByRole("heading", { name: "Repository not found" })).toBeVisible();
  await expect(page.getByText("It may be private or misspelled")).toBeVisible();
});

test("pasting a URL in the repository field opens it", async ({ page, context }) => {
  await fakeGitHub(context);
  await page.goto("/alacritty/alacritty?at=2021-03-18");
  const field = page.getByRole("combobox", { name: "Repository" });
  await field.fill("https://github.com/BurntSushi/walkdir");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/BurntSushi\/walkdir/);
  await expect(page.locator(".commit-count")).toContainText("of 185", { timeout: 15_000 });
  // It is now among the recently opened repositories.
  await field.click();
  await expect(page.getByText("Recently opened")).toBeVisible();
});
