// Records the README clip: the demo playing at 16× speed, as a GIF.
// Run `pnpm build && pnpm preview --port 4173` first, then:
//   node scripts/record-demo.mjs ../docs/images/palimpsest.gif
// Needs ffmpeg. Uses the installed Google Chrome. FPS and WIDTH (env) size the GIF.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const out = process.argv[2] ?? "palimpsest.gif";
const url = process.argv[3] ?? "http://localhost:4173/";
const dir = mkdtempSync(join(tmpdir(), "palimpsest-clip-"));

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const started = Date.now();
await page.goto(url);
await page.locator(".legend").waitFor();
// Faster playback, so the clip covers the whole history.
await page.getByRole("button", { name: "4× speed" }).click();
await page.getByRole("button", { name: /^16×/ }).click();
const playFrom = (Date.now() - started) / 1000 + 0.3;
await page.getByRole("button", { name: "Play history" }).waitFor({ timeout: 40_000 });
const playTo = (Date.now() - started) / 1000;
await context.close();
await browser.close();

const video = join(dir, readdirSync(dir).find((f) => f.endsWith(".webm")));
const palette = join(dir, "palette.png");
const fps = process.env.FPS ?? "8";
const width = process.env.WIDTH ?? "800";
const filters = `fps=${fps},scale=${width}:-1:flags=lanczos`;
const trim = ["-ss", String(playFrom), "-to", String(playTo + 0.8), "-i", video];
execFileSync("ffmpeg", ["-v", "error", "-y", ...trim, "-vf", `${filters},palettegen=stats_mode=diff`, palette]);
execFileSync("ffmpeg", [
  "-v", "error", "-y", ...trim, "-i", palette,
  "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  out,
]);
rmSync(dir, { recursive: true });
console.log(`Wrote ${out} (${(playTo - playFrom).toFixed(1)} s of playback)`);
