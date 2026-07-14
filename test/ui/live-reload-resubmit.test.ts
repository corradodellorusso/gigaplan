import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startUiSession, type UiSession } from "./harness.js";

const V1 = `# Live Reload Resubmit Test

## Section A

Version one of this paragraph.
`;

const V2 = `# Live Reload Resubmit Test

## Section A

Version two of this paragraph, revised after review.
`;

let session: UiSession;
let tmpDir: string;
let planPath: string;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gigaplan-resubmit-"));
  planPath = path.join(tmpDir, "plan.md");
  fs.writeFileSync(planPath, V1, "utf8");
  session = await startUiSession(planPath);
});

after(async () => {
  await session.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("a live-reload after a submitted review resets the finish panel so a new review can be submitted", async () => {
  const { page } = session;

  await page.locator('[data-role="global-draft"]').fill("Looks good.");
  await page.locator('label.cdr-choice:has(input[value="approve"])').click();
  await page.locator('[data-action="submit-review"]').click();

  await page.locator(".cdr-banner--success").waitFor({ state: "visible" });
  assert.equal(await page.locator(".gp-finish-title").innerText(), "Review submitted");

  const firstReview = await session.poll(0);
  assert.ok(firstReview, "expected the first submitted review to be pollable");

  // Live-edit the plan file, as the agent does after a review round.
  fs.writeFileSync(planPath, V2, "utf8");
  await page
    .locator(".gp-commentable", { hasText: "Version two of this paragraph" })
    .waitFor({ state: "visible", timeout: 5000 });

  // The submitted banner should be gone, replaced by an active, submittable
  // panel again — not stuck showing the previous round's outcome.
  await page.locator(".cdr-banner--success").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".gp-finish-title").innerText(), "Finish your review");
  assert.equal(
    await page.locator('[data-action="submit-review"]').isDisabled(),
    true,
    "no verdict has been picked yet for this new round"
  );
  assert.equal(
    await page.locator('[data-role="global-draft"]').inputValue(),
    "",
    "the previous round's overall comment shouldn't carry into the new one"
  );

  // And it's genuinely usable again, not just visually reset.
  await page.locator('label.cdr-choice:has(input[value="approve"])').click();
  await page.locator('[data-action="submit-review"]').click();
  await page.locator(".cdr-banner--success").waitFor({ state: "visible" });

  const secondReview = await session.poll(firstReview!.reviewId);
  assert.ok(secondReview, "expected a second, distinct review to be pollable");
  assert.notEqual(secondReview!.reviewId, firstReview!.reviewId);
});
