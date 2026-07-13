import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startUiSession, type UiSession } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_PLAN = path.join(__dirname, "..", "fixtures", "jwt-migration-plan.md");

let session: UiSession;

before(async () => {
  session = await startUiSession(JWT_PLAN);
});

after(async () => {
  await session.cleanup();
});

// gigaplan strips the GFM task-list marker (`- [ ]` / `- [x]`) and renders a
// static checkbox glyph — there is no click handler to toggle it and no
// visual distinction between a checked and unchecked source item (the
// `checklist` flag on a Block is "was this a task-list item", not "was it
// checked"). This only asserts what actually renders, not a tick interaction.
test("GFM task-list items render as a checklist row with the marker stripped", async () => {
  const items = session.page.locator(".gp-item-checklist");
  const count = await items.count();
  assert.ok(count > 0, "expected at least one checklist item in the Implementation checklist section");

  const texts = await items.allInnerTexts();
  for (const text of texts) {
    assert.doesNotMatch(text, /\[[ xX]\]/, `checklist item text should not contain a raw marker: ${text}`);
  }
  assert.ok(
    texts.some((t) => t.includes("Add auth/jwt.ts issuer")),
    "expected the known first checklist item's text to survive rendering"
  );

  for (let i = 0; i < count; i++) {
    await assert.doesNotReject(items.nth(i).locator(".cdr-box").waitFor({ state: "visible" }));
  }
});
