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
