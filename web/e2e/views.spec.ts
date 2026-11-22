import { expect, test } from "@playwright/test";

const MOMENT = "/alacritty/alacritty?at=2021-03-18";
const FILE = "alacritty_terminal/src/term/mod.rs";

test("a shared address opens the same moment, view, file and line", async ({ page }) => {
  await page.goto(`${MOMENT}&view=lines&file=${FILE}&line=10`);
  await expect(page.getByRole("link", { name: "Lines" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".date")).toHaveText("18 Mar 2021");
  await expect(page.getByRole("button", { name: FILE })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Line 10 has been touched/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play history" })).toBeVisible();
  // The address keeps describing it.
  await expect.poll(() => new URL(page.url()).searchParams.get("line")).toBe("10");
});

test("Overview drills down to Tracks and Lines; Escape comes back up", async ({ page }) => {
  await page.goto(`${MOMENT}&view=overview`);
  await expect(page.getByRole("heading", { name: "Who wrote the code that exists on this day" })).toBeVisible();
  await expect(page.locator(".share-part").first()).toContainText("%");

  await page.locator(".folder-label").first().click();
  await expect(page.getByRole("link", { name: "Tracks" })).toHaveAttribute("aria-current", "page");
  await expect.poll(() => new URL(page.url()).searchParams.get("folder")).toBe("alacritty_terminal");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("link", { name: "Lines" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("One track per line.")).toBeVisible();

  const view = () => new URL(page.url()).searchParams.get("view");
  await expect.poll(view).toBe("lines");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Tracks" })).toHaveAttribute("aria-current", "page");
  await expect.poll(view).toBe(null);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");

  // Back returns to where the address was before.
  await expect.poll(view).toBe("overview");
  await page.goBack();
  await expect(page.getByRole("link", { name: "Tracks" })).toHaveAttribute("aria-current", "page");
});

test("keyboard: Space plays, arrows step, numbers switch views", async ({ page }) => {
  await page.goto(MOMENT);
  await expect(page.locator(".date")).toHaveText("18 Mar 2021");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".date")).toHaveText("18 Apr 2021");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("1");
  await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("3");
  await expect(page.getByRole("link", { name: "Lines" })).toHaveAttribute("aria-current", "page");
});

test("the repository menu opens another demo, and rejects what is not a repository", async ({ page }) => {
  await page.goto(MOMENT);
  await page.getByRole("combobox", { name: "Repository" }).click();
  await expect(page.getByRole("option", { name: /alacritty\/alacritty.*the demo/ })).toBeVisible();
  await page.getByRole("option", { name: /BurntSushi\/ripgrep/ }).click();
  await expect(page).toHaveURL(/\/BurntSushi\/ripgrep/);
  await expect(page.locator(".legend")).toContainText("Andrew Gallant");

  const field = page.getByRole("combobox", { name: "Repository" });
  await field.fill("not a repository");
  await field.press("Enter");
  await expect(page.getByText("That does not look like a GitHub repository")).toBeVisible();
});

test("About explains the timeline, lists the keys and links to the source", async ({ page }) => {
  await page.goto(MOMENT);
  await page.getByRole("button", { name: "About" }).click();
  const about = page.getByRole("dialog", { name: "About Palimpsest" });
  await expect(about).toContainText("A git time machine");
  await expect(about).toContainText("Find a file in Tracks");
  await expect(about.getByRole("link", { name: "Nayed Saïd Ali" })).toHaveAttribute("href", "https://github.com/nayed");
  await expect(about.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/nayed/palimpsest",
  );

  // Escape closes it, and only it: the view stays.
  const url = page.url();
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(page.getByRole("button", { name: "About" })).toBeFocused();

  // A click elsewhere closes it too.
  await page.getByRole("button", { name: "About" }).click();
  await expect(about).toBeVisible();
  await page.locator(".legend").click({ position: { x: 4, y: 4 } });
  await expect(about).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tracks put file names above them, and a tap opens the lines", async ({ page }) => {
    await page.goto(MOMENT);
    await expect(page.getByText("Drag the timeline to scrub. Tap a track to see its lines.")).toBeVisible();
    await expect(page.locator(".row-label.above").first()).toBeVisible();
    await expect(page.locator(".code")).toHaveCount(0);
    const box = (await page.locator(".row-label.above").first().boundingBox())!;
    await page.mouse.click(box.x + 150, box.y + box.height + 14);
    await expect(page.getByRole("link", { name: "Lines" })).toHaveAttribute("aria-current", "page");
  });
});
