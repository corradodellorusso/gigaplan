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

test("submitting through the browser round-trips to the poll endpoint", async () => {
  const { page } = session;

  const row = page.locator(".gp-commentable", { hasText: "item one" });
  await row.locator('[data-action="toggle-composer"]').click();
  await row.locator("textarea").fill("Please add a rollback step.");
  await row.locator('[data-action="save-comment"]').click();

  await page.locator('[data-role="global-draft"]').fill("Solid plan, just the one comment.");
  // The native radio input is visually hidden behind a custom .cdr-box visual;
  // click the wrapping label the way a real reviewer would.
  await page.locator('label.cdr-choice:has(input[value="request_changes"])').click();
  await page.locator('[data-action="submit-review"]').click();

  await page.locator(".cdr-banner--success").waitFor({ state: "visible" });
  assert.equal(await page.locator(".gp-finish-title").innerText(), "Review submitted");

  const review = await session.poll(0);
  assert.ok(review, "expected the poll endpoint to return the just-submitted review");
  assert.equal(review!.verdict, "request_changes");
  assert.equal(review!.globalComment, "Solid plan, just the one comment.");
  assert.equal(review!.comments.length, 1);
  assert.equal(review!.comments[0].body, "Please add a rollback step.");
  assert.deepEqual(review!.comments[0].headingBreadcrumb, ["Sample Plan", "Step 1: Setup"]);
  assert.equal(review!.comments[0].stale, false);
});
