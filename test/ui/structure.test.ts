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

test("page title and h1 come from the plan's first h1", async () => {
  assert.equal(await session.page.title(), "Sample Plan · gigaplan");
  assert.equal(await session.page.locator(".gp-topbar-title").innerText(), "Sample Plan");
});

test("each ## heading becomes its own section", async () => {
  const titles = await session.page.locator(".gp-section-title").allInnerTexts();
  assert.deepEqual(titles, ["Step 1: Setup", "Step 2: Migrate database"]);
});

test("topbar meta reports section and comment counts", async () => {
  const meta = await session.page.locator(".gp-topbar-meta").innerText();
  assert.match(meta, /2 sections/);
  assert.match(meta, /0 comments/);
});


test("code fence copy button flips to Copied and reverts", async () => {
  const copyBtn = session.page.locator('[data-action="copy-code"]').first();
  await assert.doesNotReject(copyBtn.waitFor({ state: "visible" }));
  await copyBtn.click();
  await session.page.waitForFunction(
    (el) => el?.textContent === "Copied",
    await copyBtn.elementHandle()
  );
  await session.page.waitForFunction(
    (el) => el?.textContent === "Copy",
    await copyBtn.elementHandle(),
    { timeout: 3000 }
  );
});
