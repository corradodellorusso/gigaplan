import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startUiSession, type UiSession } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PLAN = path.join(__dirname, "..", "fixtures", "sample-plan.md");

let session: UiSession;

before(async () => {
  session = await startUiSession(SAMPLE_PLAN);
});

after(async () => {
  await session.cleanup();
});

test("theme toggle flips the documentElement's data-theme attribute", async () => {
  const { page } = session;
  const getTheme = () => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

  const initial = await getTheme();
  assert.ok(initial === "light" || initial === "dark", `unexpected initial theme: ${initial}`);

  await page.locator('[data-action="toggle-theme"]').click();
  const toggled = await getTheme();
  assert.notEqual(toggled, initial);

  await page.locator('[data-action="toggle-theme"]').click();
  assert.equal(await getTheme(), initial);
});
