# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

gigaplan renders an agent-authored Markdown plan as a themed review page in the
user's browser — the "Atelier / Terminal" design system (`public/chrome.css`):
each `##` heading becomes a numbered, collapsible section; every
heading/paragraph/list-item/fence/table is individually commentable; a sidebar
tracks review coverage and lists every comment; a "Finish your review" panel
collects an overall comment plus a verdict (Approve / Request changes). Hands
the reviewer's structured feedback back to the agent via CLI polling.
The visual design was imported from a Claude Design System project
via the `claude_design` MCP (DesignSync tool) — see `skills/gigaplan/SKILL.md`
for the workflow this UI supports, not the visual spec itself.

**The hard rule this whole design serves: the agent only ever writes plain
Markdown, never HTML.** All rendering/theming/interactivity is gigaplan's own
code, written once — this is what keeps plan review cheap in tokens.

## Commands

```
npm install       # also runs the build (prepare script)
npm run typecheck # tsc --noEmit against both the server and client TypeScript
npm test          # node:test, run directly against .ts sources via tsx
npm run build     # src/*.ts -> dist/ (tsconfig.server.json), client/chrome.ts -> public/chrome.js (tsconfig.client.json)
```

Run a single test file: `node --import tsx --test test/markdown.test.ts`.
There is no separate lint script.

Manual/CLI smoke test (no automated test drives the CLI or a real browser —
see "Verifying changes" below):

```
node bin/gigaplan.js review test/fixtures/sample-plan.md
node bin/gigaplan.js poll test/fixtures/sample-plan.md
node bin/gigaplan.js end test/fixtures/sample-plan.md
```

## Architecture

**Everything is ESM** (`"type": "module"`, `tsconfig.server.json` uses
`module`/`moduleResolution: NodeNext`). This is load-bearing, not a style choice:
`chokidar` and `open` are ESM-only in the versions this project depends on, so
`require()`-based CommonJS is not an option. Consequences that matter when
editing:
- Every relative import in `src/*.ts` needs an explicit `.js` extension
  (`from "./paths.js"`, not `from "./paths"`) — `NodeNext` resolution enforces
  this at compile time.
- No `__dirname`/`__filename`/`require.main` — `src/server.ts` and `src/cli.ts`
  derive these via `fileURLToPath(import.meta.url)`.
- `bin/gigaplan.js` is the one hand-written plain-JS file (a shebang shim); it
  uses `import` too, since `package.json`'s `"type": "module"` applies to it.

**Two separate TypeScript compilations**, because server code (Node/CommonJS-era
APIs, no DOM) and browser code (DOM, no Node APIs) need different `lib`/`module`
settings:
- `tsconfig.server.json`: compiles `src/**/*.ts` -> `dist/`. This is the CLI +
  Express server.
- `tsconfig.client.json`: compiles `client/chrome.ts` -> `public/chrome.js`
  (loaded via `<script type="module">`). This file has **zero imports** — it's
  vanilla DOM code with locally-declared types mirroring the server's JSON
  shapes, not a shared import from `src/types.ts` — that's deliberate, to avoid
  cross-config `rootDir`/`outDir` gymnastics for two files with different
  target environments. No React, no bundler; `tsc` is the only build step for
  both sides.

**Request flow** (`src/cli.ts` -> `src/server.ts`):
1. `gigaplan review <path>` canonicalizes the path, ensures a shared detached
   server is running (spawns `dist/server.js` if `~/.gigaplan/server.json`'s
   pid isn't alive), POSTs `/api/sessions`, opens the browser.
2. The server (`src/server.ts`) parses the plan file with `src/markdown.ts`
   into an ordered array of `Block`s (`src/types.ts`), one per top-level
   markdown-it construct (heading/paragraph/fence/table/blockquote/hr) —
   grouped by walking the token stream and tracking open/close nesting depth,
   *not* by hardcoding block-type names. **Lists are the one exception**: a
   `bullet_list`/`ordered_list` group is split into one `list_item` Block per
   `<li>` (via `splitListIntoItemGroups`, which re-runs the same depth-tracking
   grouper on the list's inner tokens) so each list item is individually
   commentable/anchorable, not the list as a whole. GFM task-list syntax
   (`- [ ] ...` / `- [x] ...`) is detected per item via a regex on its plain
   text (markdown-it has no native task-list rule) and flagged `checklist:
   true` with the marker stripped from the rendered HTML. Each block gets a
   sequential id (`b1, b2, ...`) and a content hash (first 6 hex chars of a
   SHA-256 of normalized text).
3. `src/render.ts` emits a near-empty HTML shell (fonts, `chrome.css`, a
   `data-theme` bootstrap script to avoid a flash of the wrong theme, the JSON
   blocks island, one `#gp-app` mount div). **`public/chrome.js`** (compiled
   from `client/chrome.ts`) builds the *entire* visible page from that JSON —
   top bar, sections, sidebar, finish panel — every time state changes.
   `client/chrome.ts` also does its own presentation-layer grouping that the
   server doesn't know about: `buildSections()` walks the flat `Block[]` and
   starts a new section at every `headingLevel === 2` block (the first `h1`,
   if any, becomes the page title instead of a section). The few functional
   icons (chevron collapse, comment bubble, theme sun/moon, checkbox tick,
   success banner check) are inlined SVGs copied from Lucide's path data
   (`ICON_PATHS`) — no icon library dependency, matching the "no CDN JS"
   principle (Google Fonts is the one exception, see README's Development
   section). An earlier version also auto-picked a per-section icon from a
   keyword heuristic on the heading text; that was removed — it looked
   invented (because it was) and added no real signal.
4. Chokidar watches the plan file. On change, `src/markdown.ts`'s
   `reconcileBlocks(oldBlocks, freshBlocks)` diffs old vs. new: exact hash
   match first (block moved but unchanged — carry the id forward), then
   positional match among what's left (block edited — carry the id forward but
   flag it `stale`), then leftover new blocks are insertions (fresh ids past
   any existing max) and leftover old blocks are `orphaned` (deleted, but their
   comments are never dropped — surfaced in a "Comments on removed content"
   section instead). This only needs to protect **pending, unsubmitted**
   browser-side comments against a live edit; a submitted review is a
   historical record and isn't re-reconciled. Reconciliation results push to
   the browser over SSE (`/api/sessions/:key/events`).
5. `src/review-store.ts` holds review state **in memory only** (submitted
   reviews, the long-poll waiter list) — not persisted to disk. `gigaplan poll
   <path>` long-polls `/api/sessions/:key/poll?since=<reviewId>` (60s timeout,
   204-then-retry loop) and prints the result as **compact Markdown**, not
   JSON, formatted by `verdictTitle`/`formatReviewAsMarkdown` in `src/cli.ts` —
   cheap for the agent to ingest. The `since` cursor is tracked client-side per
   plan path in `~/.gigaplan/state.json` (`SessionRecord.lastPolledReviewId`,
   written by the CLI after each successful poll, *not* by the server on
   submit) — this is what lets a second `poll` call wait for a genuinely new
   review instead of immediately re-returning the one it already saw.
6. `src/session-store.ts` is the only disk-persisted state: `~/.gigaplan/
   state.json` (sessions keyed by canonical plan path) and `~/.gigaplan/
   server.json` (the shared server's `{pid, port}` lock, liveness-checked via
   `process.kill(pid, 0)` before being trusted).

The server is single-shared-process across sessions:
loopback-only, default port 4873 (`GIGAPLAN_PORT`), self-shuts-down after
inactivity (`GIGAPLAN_IDLE_TIMEOUT_MS`, default 30 min) via a middleware-reset
timer — `gigaplan end <path>` only marks that one session done, it never stops
the server.

## The Claude Code skill

`skills/gigaplan/SKILL.md` is the actual entry point an agent sees — it
documents the write-plan.md -> `review` -> `poll` -> revise -> loop workflow and
is written in the standard skill frontmatter format (`name`, `description`,
`user-invocable`). It is built here but **not installed** by anything in this
repo; installation is handled separately (e.g. via `skills.sh`/an external
installer), globally or per-project.

## Verifying changes

There's no automated coverage for the CLI process lifecycle — that still
needs manual verification (run the CLI commands above against
`test/fixtures/sample-plan.md`). The browser UI, though, has real coverage now:
`npm run test:ui` (`test/ui/*.test.ts`, `node:test` + plain `playwright`, kept
separate from the fast default `npm test` since it needs a browser —
`playwright install chromium` once locally) drives comment/edit/remove,
verdict-gating rules, submit -> poll, theme toggle, live-reload reconciliation
(stale + orphaned comments), and rendering edge cases via
`test/fixtures/torture-test-plan.md`.

`test/ui/harness.ts` spins up an isolated server per test file: a spawned
child process (`test/ui/server-entry.ts`), not an in-process import — because
`createApp()`'s idle-timeout middleware calls `process.exit(0)` directly, and
importing it in-process would risk killing the test runner itself if a slow
suite ever tripped that timer. Each child gets its own OS-assigned free port
and its own `GIGAPLAN_HOME` temp dir (an env override on `STATE_DIR`, same
pattern as `GIGAPLAN_PORT`/`GIGAPLAN_IDLE_TIMEOUT_MS`), so tests never touch
the real `~/.gigaplan/state.json`. Playwright launches its own disposable
Chromium (`chromium.launch()` + a fresh context with clipboard permissions
granted for the copy-button test) — never the developer's actual browser.

For changes not covered by `test:ui` (or when iterating manually), run the
CLI commands above against `test/fixtures/sample-plan.md` (or
`test/fixtures/jwt-migration-plan.md`, a richer fixture with all six section
"flavors" — prose, ordered steps, a GFM checklist, a code fence, bullets, and
mixed content), and actually open the session URL in a browser rather than
trusting the type-check alone. `page.goto(url, { waitUntil: "load" })`, not
`"networkidle"`: the SSE connection to `/api/sessions/:key/events` never
idles, so `networkidle` hangs forever.
