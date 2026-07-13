import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startUiSession, type UiSession } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TORTURE_PLAN = path.join(__dirname, "..", "fixtures", "torture-test-plan.md");

let session: UiSession;
let dialogCount = 0;

before(async () => {
  session = await startUiSession(TORTURE_PLAN);
  session.page.on("dialog", (dialog) => {
    dialogCount++;
    void dialog.dismiss();
  });
});

after(async () => {
  await session.cleanup();
});

test("HTML-looking markdown text renders inert, never executes", async () => {
  const bodyText = await session.page.locator("body").innerText();
  assert.match(bodyText, /<script>alert\(1\)<\/script>/);
  assert.match(bodyText, /<div class="whoops">/);
  assert.equal(dialogCount, 0, "no alert()/confirm()/prompt() dialog should ever fire");

  // The JSON blocks island is itself a <script type="application/json"> tag
  // and legitimately contains "alert(1)" as serialized text data — only
  // *executable* script tags matter for "did this actually run".
  const executableScripts = await session.page.$$eval("script", (nodes) =>
    nodes
      .filter((n) => !n.getAttribute("type") || /javascript|module/.test(n.getAttribute("type") ?? ""))
      .map((n) => n.textContent ?? "")
  );
  assert.ok(
    executableScripts.every((s) => !s.includes("alert(1)")),
    "the plan's <script>alert(1)</script> text must never become live, executable JS"
  );
});

test("a code fence containing script-looking text renders as literal code, not live HTML", async () => {
  assert.notEqual(await session.page.title(), "pwned");
  assert.match(await session.page.title(), /gigaplan/);
  const fenceText = await session.page.locator(".gp-code", { hasText: "document.title" }).innerText();
  assert.match(fenceText, /<script>document\.title = "pwned"<\/script>/);
});

test("nested sub-lists render inside their parent item, not as separate commentable rows", async () => {
  const section = session.page.locator(".gp-section", { hasText: "Nested lists" });
  // .gp-commentable[data-block-id] would also match the section's intro
  // paragraph; scope to rows wrapping an ordered-list item specifically.
  const topLevelItems = section.locator(".gp-commentable:has(.gp-item-ol)");
  assert.equal(await topLevelItems.count(), 3, "only the 3 top-level ordered items should be individually commentable");

  const secondItem = topLevelItems.nth(1);
  const secondItemText = await secondItem.innerText();
  assert.match(secondItemText, /Extract the interest-calculation logic first/);
  assert.match(secondItemText, /which itself has a nested nested bullet/);
});

test("an empty section between two others doesn't break section numbering or later sections", async () => {
  const titles = await session.page.locator(".gp-section-title").allInnerTexts();
  const emptyIdx = titles.findIndex((t) => t.includes("intentionally empty"));
  assert.ok(emptyIdx > -1, "the intentionally-empty section should still exist");
  assert.match(titles[emptyIdx + 1], /03 · Ordered list/);
});

test("an ordered list starting at 5 keeps its source ordinals", async () => {
  const section = session.page.locator(".gp-section", { hasText: "Ordered list starting at an unusual number" });
  const ordinals = await section.locator(".gp-ordinal").allInnerTexts();
  assert.deepEqual(ordinals, ["5.", "6.", "7."]);
});

test("a table cell with an escaped pipe renders the literal character, not a broken column", async () => {
  const section = session.page.locator(".gp-section", { hasText: "Tables torture test" });
  const cell = section.locator("td", { hasText: "ISO 4217 code" });
  assert.match(await cell.innerText(), /a \| b/);
});

test("h3/h4 subheadings inside a section stay inside it rather than starting new sections", async () => {
  const titles = await session.page.locator(".gp-section-title").allInnerTexts();
  assert.ok(!titles.some((t) => t.includes("A subheading")), "an h3 must not become its own numbered section");

  const section = session.page.locator(".gp-section", { hasText: "Unicode, emoji" });
  assert.match(await section.innerText(), /A subheading \(h3\)/);
  assert.match(await section.innerText(), /And an h4 for good measure/);
});

test("emoji and unicode content render without breaking block extraction", async () => {
  const section = session.page.locator(".gp-section", { hasText: "Unicode, emoji" });
  const text = await section.innerText();
  assert.match(text, /🚀/);
  assert.match(text, /日本語のテキスト/);
});
