import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startUiSession, type UiSession } from "./harness.js";

const ORIGINAL = `# Live Reload Test

## Section A

Edit this paragraph please.

## Section B

Delete this section's paragraph.
`;

const EDITED = `# Live Reload Test

## Section A

Edited paragraph, now different.

## Section B
`;

let session: UiSession;
let tmpDir: string;
let planPath: string;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gigaplan-live-reload-"));
  planPath = path.join(tmpDir, "plan.md");
  fs.writeFileSync(planPath, ORIGINAL, "utf8");
  session = await startUiSession(planPath);
});

after(async () => {
  await session.cleanup();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("editing the plan file on disk flags an edited-but-commented block stale and orphans a deleted one", async () => {
  const { page } = session;

  const editRow = page.locator(".gp-commentable", { hasText: "Edit this paragraph please." });
  await editRow.locator('[data-action="toggle-composer"]').click();
  await editRow.locator("textarea").fill("Can you clarify this step?");
  await editRow.locator('[data-action="save-comment"]').click();

  const deleteRow = page.locator(".gp-commentable", { hasText: "Delete this section's paragraph." });
  const deletedBlockId = await deleteRow.getAttribute("data-block-id");
  await deleteRow.locator('[data-action="toggle-composer"]').click();
  await deleteRow.locator("textarea").fill("This section is going away, keep this for the agent.");
  await deleteRow.locator('[data-action="save-comment"]').click();

  // Live-edit the plan file; chokidar (150ms debounce) -> SSE "changed" ->
  // client refetches /blocks and reconciles.
  fs.writeFileSync(planPath, EDITED, "utf8");

  const editedRow = page.locator(".gp-commentable", { hasText: "Edited paragraph, now different." });
  await editedRow.waitFor({ state: "visible", timeout: 5000 });
  await editedRow.locator(".gp-stale-banner").waitFor({ state: "visible" });
  assert.equal(
    await editedRow.locator(".gp-stale-banner").innerText(),
    "Content changed since this comment was left."
  );
  // The comment body itself survives the edit, carried forward on the same block id.
  assert.equal(await editedRow.locator(".gp-thread-comment-body").innerText(), "Can you clarify this step?");

  const orphanedSidebarRow = page.locator(`.gp-comment-row[data-block-id="${deletedBlockId}"]`);
  await orphanedSidebarRow.waitFor({ state: "visible" });
  assert.equal(await orphanedSidebarRow.locator(".gp-comment-row-section").innerText(), "removed section");
  assert.equal(
    await orphanedSidebarRow.locator(".gp-comment-row-text").innerText(),
    "This section is going away, keep this for the agent."
  );
});
