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

test("request-changes stays disabled until a comment exists; approve label reflects it; submit gates on a verdict", async () => {
  const { page } = session;
  const approveRadio = page.locator('input[data-action="set-verdict"][value="approve"]');
  const requestRadio = page.locator('input[data-action="set-verdict"][value="request_changes"]');
  // The native radio inputs are visually hidden behind a custom .cdr-box
  // visual; a real reviewer clicks the wrapping label, not the input itself.
  const approveChoice = page.locator('label.cdr-choice:has(input[value="approve"])');
  const requestChoice = page.locator('label.cdr-choice:has(input[value="request_changes"])');
  const approveLabel = page.locator('[data-role="approve-label"]');
  const submitBtn = page.locator('[data-action="submit-review"]');
  const globalDraft = page.locator('[data-role="global-draft"]');

  assert.equal(await requestRadio.isDisabled(), true);
  assert.equal(await approveLabel.innerText(), "Approve");
  assert.equal(await submitBtn.isDisabled(), true);

  await approveChoice.click();
  assert.equal(await submitBtn.isDisabled(), false);

  await globalDraft.fill("Looks solid overall, one nit below.");
  assert.equal(await requestRadio.isDisabled(), false);
  assert.equal(await approveLabel.innerText(), "Approve with comments");

  await requestChoice.click();
  assert.equal(await requestRadio.isChecked(), true);
  assert.equal(await submitBtn.isDisabled(), false);

  // Clearing the only source of "any comments" should snap back to disabled
  // and uncheck request-changes rather than leaving a dangling verdict.
  await globalDraft.fill("");
  await page.waitForFunction(
    () => (document.querySelector('input[data-action="set-verdict"][value="request_changes"]') as HTMLInputElement)?.disabled === true
  );
  assert.equal(await requestRadio.isChecked(), false);
  assert.equal(await submitBtn.isDisabled(), true);
});
