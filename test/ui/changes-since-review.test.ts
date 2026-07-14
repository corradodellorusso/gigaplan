import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startUiSession, type UiSession } from "./harness.js";

const STAGE0 = `# Changes Since Review Test

## Section A

Unchanged paragraph.

## Section B

This paragraph will be edited.

## Section C

This paragraph will be removed entirely.
`;

// Only Section B's paragraph changes here — isolated on purpose. reconcileBlocks'
// positional-matching pass pairs leftover old/new blocks by index, so an edit
// landing in the same save as an unrelated insertion/deletion can get misread as
// one big "edit" instead of a separate add + remove (a pre-existing, documented
// best-effort limitation of that heuristic, not something this feature should
// rely on surviving). Each stage below changes exactly one thing.
const STAGE1 = `# Changes Since Review Test

## Section A

Unchanged paragraph.

## Section B

This paragraph has been edited to address feedback.

## Section C

This paragraph will be removed entirely.
`;

const STAGE2 = `# Changes Since Review Test

## Section A

Unchanged paragraph.

Brand new paragraph added in this revision.

## Section B

This paragraph has been edited to address feedback.

## Section C

This paragraph will be removed entirely.
`;

const STAGE3 = `# Changes Since Review Test

## Section A

Unchanged paragraph.

Brand new paragraph added in this revision.

## Section B

This paragraph has been edited to address feedback.

## Section C
`;

let session: UiSession;
let tmpDir: string;
let planPath: string;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gigaplan-since-review-"));
  planPath = path.join(tmpDir, "plan.md");
  fs.writeFileSync(planPath, STAGE0, "utf8");
  session = await startUiSession(planPath);
});

after(async () => {
  await session.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function submitApprove(page: UiSession["page"]): Promise<void> {
  await page.locator('label.cdr-choice:has(input[value="approve"])').click();
  await page.locator('[data-action="submit-review"]').click();
  await page.locator(".cdr-banner--success").waitFor({ state: "visible" });
}

test("highlights what changed since the last submitted review, and clears once a new one is submitted", async () => {
  const { page } = session;

  // Before any review has ever been submitted, there's no baseline to diff
  // against, so nothing should be highlighted.
  assert.equal(await page.locator(".gp-changed-updated, .gp-changed-new").count(), 0);
  assert.equal(await page.locator(".gp-change-summary").count(), 0);

  // Round 1: approve with no comments, establishing the baseline snapshot.
  await submitApprove(page);

  // --- an edit alone, isolated ---
  fs.writeFileSync(planPath, STAGE1, "utf8");
  const editedRow = page.locator(".gp-commentable", { hasText: "This paragraph has been edited" });
  await editedRow.waitFor({ state: "visible", timeout: 5000 });
  assert.ok(await editedRow.evaluate((el) => el.classList.contains("gp-changed-updated")));
  assert.equal(await editedRow.locator(".cdr-badge--warning").innerText(), "Updated");
  assert.equal(await page.locator(".gp-changed-new").count(), 0);
  assert.equal(await page.locator(".gp-change-summary").innerText(), "1 updated since your last review");

  const unchangedRow = page.locator(".gp-commentable", { hasText: "Unchanged paragraph." });
  assert.equal(
    await unchangedRow.evaluate(
      (el) => el.classList.contains("gp-changed-updated") || el.classList.contains("gp-changed-new")
    ),
    false
  );

  // Reopening the tab (a fresh page load, as `gigaplan review` would produce)
  // must not by itself clear the highlight — only submitting a new review does.
  await page.reload({ waitUntil: "load" });
  await page.locator(".gp-change-summary").waitFor({ state: "visible" });
  assert.equal(await page.locator(".gp-change-summary").innerText(), "1 updated since your last review");

  // Round 2: submit again, moving the baseline forward to STAGE1.
  await submitApprove(page);
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator(".gp-changed-updated, .gp-changed-new").count(), 0);
  assert.equal(await page.locator(".gp-change-summary").count(), 0);

  // --- an insertion alone, isolated ---
  fs.writeFileSync(planPath, STAGE2, "utf8");
  const newRow = page.locator(".gp-commentable", { hasText: "Brand new paragraph added" });
  await newRow.waitFor({ state: "visible", timeout: 5000 });
  assert.ok(await newRow.evaluate((el) => el.classList.contains("gp-changed-new")));
  assert.equal(await newRow.locator(".cdr-badge--success").innerText(), "New");
  assert.equal(await page.locator(".gp-changed-updated").count(), 0);
  assert.equal(await page.locator(".gp-change-summary").innerText(), "1 new since your last review");

  // Round 3: submit again, moving the baseline forward to STAGE2.
  await submitApprove(page);
  await page.reload({ waitUntil: "load" });
  assert.equal(await page.locator(".gp-changed-updated, .gp-changed-new").count(), 0);
  assert.equal(await page.locator(".gp-change-summary").count(), 0);

  // --- a deletion alone, isolated ---
  fs.writeFileSync(planPath, STAGE3, "utf8");
  await page.locator(".gp-change-summary").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.locator(".gp-changed-updated, .gp-changed-new").count(), 0);
  assert.equal(await page.locator(".gp-change-summary").innerText(), "1 removed since your last review");
  assert.equal(await page.locator(".gp-commentable", { hasText: "This paragraph will be removed entirely." }).count(), 0);
});
