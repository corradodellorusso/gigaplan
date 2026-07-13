# Plan: Automated Browser UI Test Suite for gigaplan

Right now the only automated coverage is `test/markdown.test.ts` and
`test/session-store.test.ts` — block parsing/reconciliation and session
CRUD. Everything that actually renders in the browser (`client/chrome.ts`,
`public/chrome.css`, the Express routes in `src/server.ts`) is verified by
hand: launch Playwright ad hoc, screenshot both themes, click through a
comment/verdict/submit loop. This plan turns that manual pass into a
checked-in, repeatable suite.

## 1. Two infra risks found while reading the server code

Before designing test cases, I read `src/server.ts`, `src/session-store.ts`,
and `src/paths.ts` to see how a test would actually stand up a server
instance. Two things need handling before any test can be hermetic:

1. `createApp()`'s idle-timeout middleware calls `process.exit(0)` directly
   once `IDLE_TIMEOUT_MS` elapses with no requests. If a test imports
   `createApp` and runs it **in the same process** as the test runner, an
   idle timeout mid-suite kills the whole test run, not just the server.
2. `session-store.ts` persists to a real file — `~/.gigaplan/state.json` —
   not an in-memory map. Any test that hits `POST /api/sessions` writes into
   the developer's or CI runner's actual gigaplan state, and could collide
   with a real session on that machine.

Proposed mitigations:

- Run the server-under-test in a **spawned child process**, not imported
  in-process. A stray `process.exit(0)` then only kills the child. The
  child calls `app.listen(0, "127.0.0.1")` (OS-assigned ephemeral port) and
  prints the bound port as JSON on stdout for the test harness to read.
- Add a `GIGAPLAN_HOME` env var override for `STATE_DIR` in `src/paths.ts`,
  following the same pattern as the existing `GIGAPLAN_PORT` and
  `GIGAPLAN_IDLE_TIMEOUT_MS`. Tests point it at a per-test temp directory so
  they never touch the real `~/.gigaplan`. This is a small, reusable source
  change, not test-only scaffolding.

## 2. Test harness

New `test/ui/harness.ts`:

```ts
// sketch, not final code
export async function startSession(fixturePath: string) {
  const tmpHome = await mkdtemp(...);           // GIGAPLAN_HOME target
  const child = spawn("node", ["--import", "tsx", "test/ui/server-entry.ts"], {
    env: { ...process.env, GIGAPLAN_HOME: tmpHome, GIGAPLAN_PORT: "0" },
  });
  const port = await readPortFromStdout(child);
  const { url } = await postJson(`http://127.0.0.1:${port}/api/sessions`, {
    planPath: fixturePath,
  });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load" }); // never "networkidle" — SSE never idles
  return { page, browser, child, tmpHome, cleanup: async () => { ... } };
}
```

`test/ui/server-entry.ts` is a tiny entry point that calls `createApp()` and
`listen(0, ...)`, printing `{"port": <n>}` once bound — the child process
`server-entry.ts` needs, since `src/server.ts`'s own `startServer()` binds to
the fixed `PORT` constant rather than an ephemeral one.

## 3. Open decision: test runner choice

Existing tests use plain `node:test`, run directly against `.ts` via `tsx`
(no other test framework in the project). Two ways to drive Playwright from
that:

- **Option A** — keep using the plain `playwright` package (just
  `chromium.launch()`), driven from `node:test`, same as the ad hoc manual
  verification already does. No new test-runner concept enters the project.
- **Option B** — adopt `@playwright/test` as a second, UI-specific runner.
  Nicer built-in fixtures/retries/trace-viewer, but a second test-running
  concept alongside `node:test`, and a new kind of devDependency the project
  hasn't had before.

Recommending **Option A** for consistency with the rest of the suite, but
flagging this explicitly since it's a framework choice, not an implementation
detail I should just decide silently.

Either option launches Playwright's own bundled Chromium via
`chromium.launch()` — a fresh, isolated browser instance downloaded by
`playwright install chromium`, with its own throwaway profile. It never
attaches to, reuses, or drives the reviewer's actual installed Chrome/daily
browser window; each test run gets its own disposable browser process that's
closed in teardown.

## 4. Scenario coverage for v1

- [ ] Page load & section structure — `sample-plan.md`'s `# Sample Plan` h1
      becomes the page title, `## Step 1` / `## Step 2` become numbered,
      collapsible sections
- [ ] Commenting lifecycle — open composer, save a comment, edit it, cancel
      an in-progress edit, remove it; sidebar's comment list and coverage
      count update at each step
- [ ] Section collapse/expand toggle
- [ ] Checklist rendering & ticking — `jwt-migration-plan.md`'s
      "Implementation checklist" section (GFM task-list items)
- [ ] Code fence copy button — click "Copy" on `sample-plan.md`'s
      ` npm run migrate ` fence, label flips to "Copied" and reverts after
      ~1.2s
- [ ] Verdict gating rules — "Request changes" stays disabled with zero
      comments and an empty global-comment field; the Approve label swaps to
      "Approve with comments" once any comment exists; Submit stays disabled
      until a valid verdict is selected
- [ ] Submit -> poll round trip — submit through the browser, confirm
      `GET /api/sessions/:key/poll` (or the CLI's `poll` command) returns the
      matching verdict and comments
- [ ] Live-reload reconciliation — edit the plan file on disk while a
      session is open; confirm the SSE `changed` event fires, an edited
      block that already has a comment gets flagged "stale," and a deleted
      block's comment surfaces under "Comments on removed content"
- [ ] Theme toggle — flips and persists the `data-theme` attribute
- [ ] Edge-case rendering via `torture-test-plan.md` — nested list items
      stay non-commentable at the sub-level, HTML-looking text
      (`<script>alert(1)</script>`) renders inert rather than executing,
      emoji/curly-quote content doesn't break block hashing

## 5. Where these live / how they run

- New directory `test/ui/*.test.ts`, plus the harness and server-entry
  helper files above.
- New npm script `test:ui`, kept separate from `npm test` — Playwright needs
  a one-time browser download (`playwright install chromium`) that the fast
  default test run shouldn't be forced to carry.
- `npm test` stays exactly as-is.
- `CLAUDE.md`'s "Verifying changes" section gets a short update once this
  lands, since it currently states the browser UI has no automated coverage
  at all.

## 6. Out of scope for this pass

- Visual regression / pixel-diff screenshots — possible future follow-up,
  not this one
- Testing the CLI process lifecycle itself (spawning `gigaplan review` /
  `poll` / `end` as real subprocesses against the shared-server singleton
  and its port/pid lock file) — a different problem, process and lock
  management rather than UI, better scoped as its own plan
- Cross-browser coverage — Chromium only for v1

## Open questions for you

1. Runner choice: plain `playwright` via `node:test` (Option A, recommended)
   or adopt `@playwright/test` (Option B)?
2. OK to add the `GIGAPLAN_HOME` env override to `src/paths.ts` as real
   source, not just test scaffolding?
