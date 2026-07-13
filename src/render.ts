import * as path from "node:path";
import type { Block } from "./types.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Guards against a code fence or comment containing a literal `</script>` sequence
// from prematurely closing the embedded JSON island (see gigaplan/project-artifact
// precedent: escape `<` as < inside any JSON blob placed inside a <script> tag).
function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function planTitle(planPath: string, blocks: Block[]): string {
  const firstHeading = blocks.find((b) => b.headingLevel === 1);
  if (firstHeading) return firstHeading.headingBreadcrumb[firstHeading.headingBreadcrumb.length - 1];
  return path.basename(planPath);
}

export function renderSessionPage(sessionKey: string, planPath: string, blocks: Block[]): string {
  const title = escapeHtml(planTitle(planPath, blocks));
  const initialData = embedJson({ sessionKey, planPath, blocks });

  // client/chrome.ts builds the entire visible page (top bar, sections, sidebar,
  // finish panel) from the JSON island below — this shell only supplies the
  // theme tokens, fonts, and mount point.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} · gigaplan</title>
<link rel="stylesheet" href="/public/chrome.css" />
<script>
  (function () {
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  })();
</script>
</head>
<body>
<div id="gp-app" class="gp-app"></div>
<script type="application/json" id="gigaplan-data">${initialData}</script>
<script type="module" src="/public/chrome.js"></script>
</body>
</html>
`;
}
