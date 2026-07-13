# gigaplan

Review agent-authored implementation plans in a browser, styled as a proper
review tool rather than a wall of terminal text. The agent writes a plain
Markdown plan — never HTML — and gigaplan renders it into numbered, collapsible
sections with per-step inline comments, a review-coverage sidebar, and a
finish-your-review panel (Approve / Approve with comments / Request changes),
then hands the structured feedback back to the agent to act on.

[gigaplan on npm](https://www.npmjs.com/package/gigaplan) ·
[gigaplan on skills.sh](https://www.skills.sh/corradodellorusso/gigaplan/gigaplan)

The UI follows the "Atelier / Terminal" design system (warm-paper light theme,
phosphor-terminal dark theme, Bricolage Grotesque + JetBrains Mono type) —
see `skills/gigaplan/SKILL.md` for the review workflow and `public/chrome.css`
for the theme itself.

## Getting started

No install needed — try it against any Markdown file:

```
npx -y gigaplan review path/to/plan.md
```

That opens your browser straight to the review page. Leave a few comments,
pick a verdict, and submit — then, in a second terminal:

```
npx -y gigaplan poll path/to/plan.md
```

blocks until you do, then prints back exactly the compact-markdown feedback an
agent would read. `npx -y gigaplan end path/to/plan.md` marks the session done
afterward (the shared local server itself stays running independently — see
Configuration below).

### Installing the skill

The point of gigaplan is for an *agent* — any agent, not tied to one product —
to drive this loop on your behalf: write the plan, open it for you, wait for
your review, and revise based on your comments, looping until you approve it.
Install the skill so it's picked up automatically, without you needing to
invoke anything by name:

```
npx skills add https://github.com/corradodellorusso/gigaplan --skill gigaplan
```

`skills/gigaplan/SKILL.md` documents the exact workflow and CLI contract an
agent follows — read it if you want to know precisely what happens under the
hood.

## How it works

```
agent writes plan.md (plain Markdown, never HTML)
  -> npx -y gigaplan review <path>    opens a browser tab rendering the plan as
                                       numbered sections (## headings), each with
                                       per-item inline comments
  -> reviewer comments on specific steps and/or leaves overall feedback, then
     selects Approve / Request changes and submits
  -> npx -y gigaplan poll <path>      blocks, then prints the review as compact markdown
  -> agent revises plan.md and loops back to `review` (reopens the same tab) until approved
  -> npx -y gigaplan end <path>       marks the session done
```

Live-reload: edit the plan file while the tab is open and it updates without a
manual refresh. A comment anchored to a section whose text changed is flagged
"content changed since this comment was left"; a comment on a deleted section is
kept, not silently dropped, in a "Comments on removed content" area.

## CLI

```
gigaplan review <path>   Open (or reuse) the browser review session for this plan file.
gigaplan poll <path>     Block until a review is submitted; print it as compact markdown.
gigaplan end <path>      Mark the review session done (the shared local server stays up;
                         it shuts itself down after a period of inactivity).
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `GIGAPLAN_PORT` | `4873` | Port the shared local server binds to (loopback-only). |
| `GIGAPLAN_IDLE_TIMEOUT_MS` | `1800000` (30 min) | How long the server stays up with no requests before it shuts itself down. |

State (session records and the server's pid/port lock) lives in `~/.gigaplan/`.

## Contributing

Working from a local checkout instead of the published package:

```
npm install        # also builds it — see the `prepare` script
node bin/gigaplan.js review path/to/plan.md   # or `npm link` once, then plain `gigaplan ...`
```

```
npm run typecheck # tsc --noEmit against both the server and client TypeScript
npm test          # node:test, run directly against .ts sources via tsx
npm run test:ui   # Playwright-driven browser UI tests (test/ui/*.test.ts); run
                   # `npx playwright install chromium` once first
npm run build     # compiles src/*.ts -> dist/, client/chrome.ts -> public/chrome.js
```

Read `CLAUDE.md` first — it covers the architecture (why the project is
ESM-only, the two separate TypeScript compilations for server vs. browser
code, the request flow through the server, how comment anchoring and
live-reload reconciliation work) and what manual verification still looks
like for the one part of the codebase test suites don't cover (the CLI
process lifecycle — the browser UI itself is covered by `npm run test:ui`).
