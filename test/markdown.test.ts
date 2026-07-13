import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlocks, reconcileBlocks } from "../src/markdown.js";

const SAMPLE = `# Plan Title

## Step 1: Setup

Do the setup work.

- item one
- item two

## Step 2: Migrate database

Run the migration.

\`\`\`sh
npm run migrate
\`\`\`

| col a | col b |
| --- | --- |
| 1 | 2 |
`;

test("parseBlocks extracts one block per top-level construct, splitting lists per item", () => {
  const blocks = parseBlocks(SAMPLE);
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types, [
    "heading",
    "heading",
    "paragraph",
    "list_item",
    "list_item",
    "heading",
    "paragraph",
    "fence",
    "table",
  ]);
});

test("parseBlocks assigns sequential ids in document order, including per list item", () => {
  const blocks = parseBlocks(SAMPLE);
  assert.deepEqual(
    blocks.map((b) => b.id),
    ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"]
  );
});

test("parseBlocks tags list items with a shared listId and bullet/ordered kind", () => {
  const blocks = parseBlocks(SAMPLE);
  const items = blocks.filter((b) => b.type === "list_item");
  assert.equal(items.length, 2);
  assert.equal(items[0].listId, items[1].listId);
  assert.equal(items[0].listKind, "bullet");
  assert.equal(items[0].ordinal, undefined);
});

test("parseBlocks strips the <li> wrapper from list item html (no leaked bullet marker)", () => {
  const blocks = parseBlocks(SAMPLE);
  const items = blocks.filter((b) => b.type === "list_item");
  for (const item of items) {
    assert.doesNotMatch(item.html, /<li[\s>]/);
    assert.doesNotMatch(item.html, /<\/li>/);
  }
  assert.match(items[0].html, /item one/);
});

test("parseBlocks numbers ordered-list items and detects GFM checklists", () => {
  const ordered = parseBlocks("1. first step\n2. second step\n");
  const orderedItems = ordered.filter((b) => b.type === "list_item");
  assert.deepEqual(
    orderedItems.map((b) => b.ordinal),
    [1, 2]
  );
  assert.deepEqual(
    orderedItems.map((b) => b.checklist),
    [false, false]
  );

  const checklist = parseBlocks("- [ ] todo one\n- [x] done one\n");
  const checklistItems = checklist.filter((b) => b.type === "list_item");
  assert.deepEqual(
    checklistItems.map((b) => b.checklist),
    [true, true]
  );
  assert.match(checklistItems[0].html, /todo one/);
  assert.doesNotMatch(checklistItems[0].html, /\[ \]/);
});

test("parseBlocks tracks heading breadcrumbs for nested content", () => {
  const blocks = parseBlocks(SAMPLE);
  const migrationParagraph = blocks.find((b) => b.excerpt.includes("Run the migration"));
  assert.deepEqual(migrationParagraph?.headingBreadcrumb, [
    "Plan Title",
    "Step 2: Migrate database",
  ]);

  const stepTwoHeading = blocks.find((b) => b.excerpt.includes("Step 2: Migrate database"));
  assert.deepEqual(stepTwoHeading?.headingBreadcrumb, ["Plan Title", "Step 2: Migrate database"]);
});

test("parseBlocks is deterministic: identical input reparses to identical hashes", () => {
  const a = parseBlocks(SAMPLE);
  const b = parseBlocks(SAMPLE);
  assert.deepEqual(
    a.map((x) => x.hash),
    b.map((x) => x.hash)
  );
});

test("reconcileBlocks carries forward ids for unchanged blocks reordered/moved", () => {
  const original = "# Title\n\nParagraph A.\n\nParagraph B.\n";
  const moved = "# Title\n\nParagraph B.\n\nParagraph A.\n";

  const oldBlocks = parseBlocks(original);
  const freshBlocks = parseBlocks(moved);
  const result = reconcileBlocks(oldBlocks, freshBlocks);

  const byExcerpt = new Map(result.blocks.map((b) => [b.excerpt, b.id]));
  const oldByExcerpt = new Map(oldBlocks.map((b) => [b.excerpt, b.id]));
  assert.equal(byExcerpt.get("Paragraph A."), oldByExcerpt.get("Paragraph A."));
  assert.equal(byExcerpt.get("Paragraph B."), oldByExcerpt.get("Paragraph B."));
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.orphaned, []);
});

test("reconcileBlocks flags an edited block as stale but keeps its id", () => {
  const original = "# Title\n\nStep 3: run the old command.\n";
  const edited = "# Title\n\nStep 3: run the NEW command instead.\n";

  const oldBlocks = parseBlocks(original);
  const freshBlocks = parseBlocks(edited);
  const paragraphOldId = oldBlocks[1].id;

  const result = reconcileBlocks(oldBlocks, freshBlocks);
  const paragraphNew = result.blocks[1];

  assert.equal(paragraphNew.id, paragraphOldId);
  assert.equal(result.stale.length, 1);
  assert.equal(result.stale[0].id, paragraphOldId);
  assert.match(result.stale[0].previousExcerpt, /old command/);
});

test("reconcileBlocks marks a deleted block's comments as orphaned, never dropped", () => {
  const original = "# Title\n\nKeep me.\n\nDelete me.\n";
  const deleted = "# Title\n\nKeep me.\n";

  const oldBlocks = parseBlocks(original);
  const freshBlocks = parseBlocks(deleted);
  const deletedId = oldBlocks[2].id;

  const result = reconcileBlocks(oldBlocks, freshBlocks);
  assert.equal(result.blocks.length, 2);
  assert.equal(result.orphaned.length, 1);
  assert.equal(result.orphaned[0].id, deletedId);
  assert.match(result.orphaned[0].excerpt, /Delete me/);
});

test("reconcileBlocks assigns fresh, non-colliding ids to inserted blocks", () => {
  const original = "# Title\n\nOnly paragraph.\n";
  const inserted = "# Title\n\nOnly paragraph.\n\nBrand new paragraph.\n";

  const oldBlocks = parseBlocks(original);
  const freshBlocks = parseBlocks(inserted);
  const maxOldId = Math.max(...oldBlocks.map((b) => Number(b.id.slice(1))));

  const result = reconcileBlocks(oldBlocks, freshBlocks);
  const newBlock = result.blocks.find((b) => b.excerpt.includes("Brand new paragraph"));
  assert.ok(newBlock);
  assert.ok(Number(newBlock!.id.slice(1)) > maxOldId);

  const existingIds = new Set(oldBlocks.map((b) => b.id));
  assert.ok(!existingIds.has(newBlock!.id));
});
