import * as crypto from "node:crypto";
import MarkdownIt from "markdown-it";
import type { Block, ReconcileResult } from "./types.js";

const md = new MarkdownIt({ html: false, linkify: true });

// Avoids depending on markdown-it's internal `lib/token` subpath export (an ESM-only
// path that classic Node module resolution can't type-resolve); derived structurally
// from the parser's own return type instead.
type Token = ReturnType<typeof md.parse>[number];

function isOpen(type: string): boolean {
  return type.endsWith("_open");
}

function isClose(type: string): boolean {
  return type.endsWith("_close");
}

function groupTopLevelBlocks(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    current.push(token);
    if (isOpen(token.type)) {
      depth++;
    } else if (isClose(token.type)) {
      depth--;
    }
    if (depth === 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function blockType(group: Token[]): string {
  const first = group[0];
  const raw = isOpen(first.type) ? first.type.slice(0, -"_open".length) : first.type;
  // Indented (4-space) code blocks render the same as fenced ones; treat them alike.
  return raw === "code_block" ? "fence" : raw;
}

const CHECKLIST_RE = /^\[([ xX])\]\s+(.*)$/s;

function splitListIntoItemGroups(group: Token[]): Token[][] {
  // Exclude the outer list_open/list_close tokens; groupTopLevelBlocks is
  // depth-relative, so it happily regroups the inner tokens by list_item.
  return groupTopLevelBlocks(group.slice(1, group.length - 1));
}

// markdown-it's renderer includes the <li>...</li> wrapper itself; the client
// re-wraps each item in its own bullet/ordinal/checkbox markup instead of a
// real <ul>/<ol>, and a bare <li> outside a list container still gets the
// browser's default disc marker — so the wrapper has to come off here.
function stripListItemWrapper(html: string): string {
  return html.replace(/^\s*<li[^>]*>\s*/, "").replace(/\s*<\/li>\s*$/, "");
}

function plainText(group: Token[]): string {
  const parts: string[] = [];
  for (const token of group) {
    if (token.type === "inline" && token.children) {
      for (const child of token.children) {
        if (child.type === "text" || child.type === "code_inline") {
          parts.push(child.content);
        }
      }
    } else if (token.type === "fence" || token.type === "code_block") {
      parts.push(token.content);
    }
  }
  return parts.join(" ");
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function hashOf(text: string): string {
  return crypto.createHash("sha256").update(normalize(text)).digest("hex").slice(0, 6);
}

function excerptOf(text: string): string {
  const normalized = normalize(text);
  return normalized.length > 80 ? `${normalized.slice(0, 80)}…` : normalized;
}

const HEADING_TAG_LEVEL: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

export function parseBlocks(source: string): Block[] {
  const tokens = md.parse(source, {});
  const groups = groupTopLevelBlocks(tokens);

  const blocks: Block[] = [];
  const headingStack: { level: number; text: string }[] = [];
  let nextId = 1;

  for (const group of groups) {
    const type = blockType(group);

    if (type === "bullet_list" || type === "ordered_list") {
      const listId = `l${nextId}`;
      const listKind: "bullet" | "ordered" = type === "ordered_list" ? "ordered" : "bullet";
      const startAttr = group[0].attrGet?.("start");
      let ordinal = startAttr ? Number(startAttr) : 1;
      const ancestorBreadcrumb = headingStack.map((h) => h.text);

      for (const itemGroup of splitListIntoItemGroups(group)) {
        const rawText = plainText(itemGroup);
        const checklistMatch = CHECKLIST_RE.exec(rawText.trim());
        const checklist = checklistMatch !== null;
        const text = checklist ? checklistMatch[2] : rawText;
        let html = stripListItemWrapper(md.renderer.render(itemGroup, md.options, {}));
        if (checklist) {
          html = html.replace(/\[[ xX]\]\s*/, "");
        }

        blocks.push({
          id: `b${nextId++}`,
          hash: hashOf(text || html),
          type: "list_item",
          headingBreadcrumb: ancestorBreadcrumb,
          html,
          excerpt: excerptOf(text),
          listId,
          listKind,
          checklist,
          ...(listKind === "ordered" ? { ordinal: ordinal++ } : {}),
        });
      }
      continue;
    }

    const text = plainText(group);
    const html = md.renderer.render(group, md.options, {});

    const first = group[0];
    const headingLevel = first.type === "heading_open" ? HEADING_TAG_LEVEL[first.tag] : undefined;

    if (headingLevel !== undefined) {
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= headingLevel
      ) {
        headingStack.pop();
      }
    }

    const ancestorBreadcrumb = headingStack.map((h) => h.text);
    const headingBreadcrumb =
      headingLevel !== undefined ? [...ancestorBreadcrumb, normalize(text)] : ancestorBreadcrumb;

    blocks.push({
      id: `b${nextId++}`,
      hash: hashOf(text || html),
      type: type as Block["type"],
      headingBreadcrumb,
      html,
      excerpt: excerptOf(text),
      ...(headingLevel !== undefined ? { headingLevel } : {}),
    });

    if (headingLevel !== undefined) {
      headingStack.push({ level: headingLevel, text: normalize(text) });
    }
  }

  return blocks;
}

export function reconcileBlocks(oldBlocks: Block[], freshBlocks: Block[]): ReconcileResult {
  const oldByHash = new Map<string, Block[]>();
  for (const block of oldBlocks) {
    const bucket = oldByHash.get(block.hash) ?? [];
    bucket.push(block);
    oldByHash.set(block.hash, bucket);
  }

  const claimedOldIds = new Set<string>();
  const claimedNewIndexes = new Set<number>();
  const result: Block[] = new Array(freshBlocks.length);

  // Pass 1: exact content match (block unchanged, possibly moved).
  freshBlocks.forEach((fresh, index) => {
    const candidates = oldByHash.get(fresh.hash);
    if (candidates && candidates.length > 0) {
      const old = candidates.shift()!;
      claimedOldIds.add(old.id);
      claimedNewIndexes.add(index);
      result[index] = { ...fresh, id: old.id };
    }
  });

  const unclaimedOld = oldBlocks.filter((b) => !claimedOldIds.has(b.id));
  const unclaimedNewIndexes = freshBlocks
    .map((_, index) => index)
    .filter((index) => !claimedNewIndexes.has(index));

  // Pass 2: positional match among what's left (block edited in place).
  const stale: { id: string; previousExcerpt: string }[] = [];
  const pairCount = Math.min(unclaimedOld.length, unclaimedNewIndexes.length);
  for (let k = 0; k < pairCount; k++) {
    const old = unclaimedOld[k];
    const newIndex = unclaimedNewIndexes[k];
    result[newIndex] = { ...freshBlocks[newIndex], id: old.id };
    stale.push({ id: old.id, previousExcerpt: old.excerpt });
  }

  // Leftover new blocks are pure insertions; give them ids past any existing max.
  const maxIdNum = Math.max(0, ...oldBlocks.map((b) => Number(b.id.slice(1)) || 0));
  let nextId = maxIdNum + 1;
  for (let k = pairCount; k < unclaimedNewIndexes.length; k++) {
    const newIndex = unclaimedNewIndexes[k];
    result[newIndex] = { ...freshBlocks[newIndex], id: `b${nextId++}` };
  }

  // Leftover old blocks were deleted; keep their comments addressable as orphaned.
  const orphaned = unclaimedOld.slice(pairCount).map((b) => ({
    id: b.id,
    excerpt: b.excerpt,
    headingBreadcrumb: b.headingBreadcrumb,
  }));

  return { blocks: result, stale, orphaned };
}
