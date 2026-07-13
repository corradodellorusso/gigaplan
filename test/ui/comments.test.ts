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

test("commenting lifecycle: save, edit, cancel-while-editing, remove", async () => {
  const { page } = session;
  const row = page.locator(".gp-commentable", { hasText: "item one" });
  const blockId = await row.getAttribute("data-block-id");
  assert.ok(blockId);

  const commentBtn = row.locator('[data-action="toggle-composer"]');
  const composer = page.locator(`[data-composer-for="${blockId}"] textarea`);

  // Open, type, save.
  await commentBtn.click();
  await composer.fill("This step needs a rollback plan.");
  await row.locator('[data-action="save-comment"]').click();

  const threadBody = row.locator(".gp-thread-comment-body");
  await assert.doesNotReject(threadBody.waitFor({ state: "visible" }));
  assert.equal(await threadBody.innerText(), "This step needs a rollback plan.");
  assert.match((await commentBtn.getAttribute("class")) ?? "", /gp-comment-btn--active/);

  let sidebarRow = page.locator(`.gp-comment-row[data-block-id="${blockId}"]`);
  assert.equal(await sidebarRow.locator(".gp-comment-row-text").innerText(), "This step needs a rollback plan.");
  assert.match(await page.locator(".gp-topbar-meta").innerText(), /1 comment\b/);

  // Edit: reopen, change text, save again.
  await row.locator('[data-action="edit-comment"]').click();
  await composer.fill("Revised: add a rollback + smoke test.");
  await row.locator('[data-action="save-comment"]').click();
  assert.equal(await threadBody.innerText(), "Revised: add a rollback + smoke test.");

  // Cancel while editing must not discard the already-saved comment.
  await row.locator('[data-action="edit-comment"]').click();
  await composer.fill("this draft should be discarded");
  await row.locator('[data-action="cancel-comment"]').click();
  assert.equal(await threadBody.innerText(), "Revised: add a rollback + smoke test.");

  // Remove clears the thread and the sidebar entry.
  await row.locator('[data-action="remove-comment"]').click();
  await assert.doesNotReject(threadBody.waitFor({ state: "detached" }));
  sidebarRow = page.locator(`.gp-comment-row[data-block-id="${blockId}"]`);
  assert.equal(await sidebarRow.count(), 0);
  assert.match(await page.locator(".gp-topbar-meta").innerText(), /0 comments/);
});

test("opening a composer without saving leaves no comment behind", async () => {
  const { page } = session;
  const row = page.locator(".gp-commentable", { hasText: "item two" });
  const blockId = await row.getAttribute("data-block-id");
  const composer = page.locator(`[data-composer-for="${blockId}"] textarea`);

  await row.locator('[data-action="toggle-composer"]').click();
  await composer.fill("a draft that never gets saved");
  await row.locator('[data-action="cancel-comment"]').click();

  assert.equal(await page.locator(`.gp-comment-row[data-block-id="${blockId}"]`).count(), 0);
});
