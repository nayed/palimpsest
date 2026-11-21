import { expect, test, type Page } from "@playwright/test";

const date = (page: Page) => page.locator(".date").textContent();

test("opens on the demo, already playing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Repository")).toHaveValue("github.com/alacritty/alacritty");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commits going by" })).toBeVisible();
  const first = await date(page);
  await expect.poll(() => date(page), { timeout: 5000 }).not.toBe(first);
  await expect(page.locator(".legend")).toContainText("Christian Duerr");
  expect(await page.locator(".row-label").count()).toBeGreaterThan(5);
});

test("pausing shows the selected file as it was; steps move one commit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play history" })).toBeVisible();
  await expect(page.getByText("The file exactly as it was at the playhead")).toBeVisible();
  await expect(page.locator(".code")).toBeVisible();

  const count = page.locator(".commit-count");
  const n = async () => Number((await count.textContent())!.match(/Commit ([\d,]+)/)![1]!.replace(/,/g, ""));
  const before = await n();
  await page.getByRole("button", { name: "Next commit" }).click();
  expect(await n()).toBe(before + 1);
  await page.getByRole("button", { name: "Previous commit" }).click();
  expect(await n()).toBe(before);
});

test("the file selected for you exists at the moment shown", async ({ page }) => {
  // CHANGELOG.md is the most-committed file but only appears in 2018.
  await page.goto("/alacritty/alacritty?at=2016-03-01");
  const selected = page.locator(".path-label.selected");
  await expect(selected).toHaveText("src/main.rs");
  await page.keyboard.press(" ");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press(" ");
  await expect(selected).toHaveText("src/main.rs");
  await expect(page.getByText("The file has no lines at this moment.")).toHaveCount(0);

  // A file named in the address is kept, even before it exists.
  await page.goto("/alacritty/alacritty?at=2016-03-01&file=CHANGELOG.md");
  await expect(selected).toHaveText("CHANGELOG.md");
});

test("dragging scrubs, and clicking a track selects its file", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause" }).click();
  const canvas = page.locator(".timeline-area");
  const box = (await canvas.boundingBox())!;

  // Drag to about four fifths of the timeline: well into the 2020s.
  // Start right of the 168px label column.
  await page.mouse.move(box.x + 200, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + 90, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".date")).toContainText(/202[2-5]/);

  // Click the third track; its label becomes the selected one.
  const label = page.locator(".row-label").nth(2);
  const labelBox = (await label.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, labelBox.y + labelBox.height / 2);
  await expect(label.locator(".path-label")).toHaveClass(/selected/);
  const path = await label.locator(".path-label").getAttribute("title");
  await expect(page.locator(".panel-title.mono")).toHaveText(path!);
});

test("resting the mouse on a clip shows who, when and how many commits", async ({ page }) => {
  await page.goto("/alacritty/alacritty?at=2021-06-01&file=alacritty/src/main.rs");
  const label = page.locator(".row-label").first();
  const labelBox = (await label.boundingBox())!;
  const box = (await page.locator(".timeline-area").boundingBox())!;
  const y = labelBox.y + labelBox.height / 2;

  // Early on, alacritty/src/main.rs was Joe Wilm's.
  await page.mouse.move(box.x + 200, y);
  const card = page.getByRole("tooltip");
  await expect(card).toContainText("Joe Wilm");
  await expect(card).toContainText(/\d+ commits, \d+ by Joe/);
  await expect(card).toContainText(/[A-Z][a-z]{2} \d{4} – [A-Z][a-z]{2} \d{4}/);

  // Off the tracks, or pressing to scrub, hides it.
  await page.mouse.move(box.x + 40, y);
  await expect(card).toHaveCount(0);
  await page.mouse.move(box.x + 200, y);
  await expect(card).toBeVisible();
  await page.mouse.down();
  await expect(card).toHaveCount(0);
  await page.mouse.up();
});

test("the speed menu changes speed and closes with Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "4× speed" }).click();
  await expect(page.getByRole("group", { name: "Playback speed" })).toBeVisible();
  await page.getByRole("button", { name: /^16×/ }).click();
  await expect(page.getByRole("button", { name: "16× speed" })).toBeVisible();
  await page.getByRole("button", { name: "16× speed" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Playback speed" })).toBeHidden();
});

test("the tracks stay drawn while playing at 16× speed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "4× speed" }).click();
  await page.getByRole("button", { name: /^16×/ }).click();
  await page.waitForTimeout(1500);
  // Count distinct colors on the canvas: a blank canvas has one.
  const colors = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>(".timeline-area canvas")!;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  });
  expect(colors).toBeGreaterThan(10);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
});
