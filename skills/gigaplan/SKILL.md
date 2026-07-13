---
name: gigaplan
description: Turn an implementation plan, design doc, or multi-step technical proposal into a browser-based review page instead of pasting it into chat as prose or asking the user to read it in the terminal — numbered collapsible sections, per-step inline comments, a review-coverage sidebar, and a finish-your-review panel that returns a structured verdict (approve / approve with comments / request changes) via CLI polling, so the plan can be revised and re-reviewed in a loop until approved. Use this whenever about to hand a plan back for review — finishing plan-mode output, proposing a migration or refactor, or any change with more than a couple of steps — even if the user never asked for a "review tool" by name. Always write the plan as plain Markdown first, never HTML; gigaplan does all the rendering and theming itself.
user-invocable: true
---

gigaplan is a local, single-purpose review tool: it takes a plan written in plain
Markdown and opens it in the user's browser as a themed review page — each `##`
section gets a number, a collapse toggle, and a "Reviewed" checkbox; every
paragraph, list item, code fence, and heading is individually commentable; a
sidebar tracks review coverage and lists every comment left so far; and a
"Finish your review" panel collects an overall comment plus a verdict (Approve /
Request changes) before submitting.

The hard rule: never hand-author HTML for a plan, even if it would look nicer.
All HTML, CSS, and interactivity are gigaplan's own code, written once — that's
what keeps a review cheap in tokens for the agent and pleasant to read for the
reviewer. If the task is a diagram, a comparison, or some other visual artifact
that isn't a plan under review, use whatever general-purpose artifact tooling
the project has instead — gigaplan only knows how to render and review plans.

## Workflow

1. **Write the plan as a plain `.md` file.** Prefer `.gigaplan/plans/<slug>.md`
   inside the project being worked on (see "Plan file conventions" below). Use
   real Markdown structure — a `##` heading per step, bullet or numbered lists
   for details — since gigaplan turns each `##` into its own reviewable section
   and anchors comments individually to every heading, paragraph, list item,
   code fence, and table; a plan that's one giant paragraph gives the reviewer
   nothing specific to comment on.
2. **Open it for review:** run `npx -y gigaplan review <path-to-plan.md>`. This
   opens (or reuses) a browser tab. Tell the user in one short sentence that the
   plan is open for review in their browser — do not restate the plan's content
   in chat; the browser page is the plan.
3. **Wait for the review:** run `npx -y gigaplan poll <path-to-plan.md>`. This
   blocks until the user submits a review. Just call it and wait; don't do other
   work in the meantime.
4. **Read the verdict.**
   - If `approved` and there are no comments (or only informational ones),
     proceed to implementation and run `npx -y gigaplan end <path-to-plan.md>`.
   - Otherwise (`request changes`, or any unresolved comments even under
     `approved`), revise the plan file **in place at the same path** —
     address every comment, don't silently drop any — then go back to step 2.
     Re-running `review` on the same path reopens the same browser tab rather
     than opening a new one, and the tab live-reloads as soon as the file is
     saved.
5. **Repeat** steps 2-4 until approved.

## Plan file conventions

gigaplan itself is path-agnostic — it takes whatever path is passed — but prefer
`.gigaplan/plans/<slug>.md` inside the target project, not some other
agent-internal plan/scratch file (an editor's own "plan mode" output, a
temp-file convention, etc.) that this skill shouldn't assume is active or
stable across a revise-and-reloop cycle.
Edit the **same file in place** across loop iterations — not `plan-v2.md`,
`plan-v3.md`, ... — since the review session is keyed by the file's path; a new
path means a new, unrelated session.

## Commands & rules

```
gigaplan review <path>   Open (or reuse) the browser review session for this plan file.
                         Prints "Opened for review: <url>" on success.

gigaplan poll <path>     Block until a review is submitted; print it as compact markdown:

  # Review: <approved|request changes>

  ## Overall comment
  <text, or "(none)">

  ## Comments
  ### On "<heading breadcrumb>"
  <comment body>
  [repeated per comment; the whole "## Comments" section is omitted if there are none]

gigaplan end <path>      Mark the review session done. Does not stop the shared
                         local server (it shuts itself down after a period of
                         inactivity independent of any single session).
```

- All three commands take the plan file's path as their only argument; no other
  flags are needed for the core loop.
- Every command runs via `npx -y gigaplan ...` — no global install required.
- If a comment is flagged as being on content that changed since it was written
  (the plan was edited again before the comment was addressed), treat it as
  still applying to the *current* version of that section unless the comment
  itself is now clearly moot.

## What this is not

Not for trivial one-line changes, a plan that's already been approved, or
non-plan content (a diagram, a comparison table, a general HTML artifact).
gigaplan is a plan reviewer, not a general HTML artifact tool, a diagramming
tool, or a way to render arbitrary content in a browser — don't reach for it
just because it opens a browser tab.
