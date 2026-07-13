interface BlockDTO {
  id: string;
  hash: string;
  type: "heading" | "paragraph" | "list_item" | "fence" | "table" | "blockquote" | "hr";
  headingBreadcrumb: string[];
  html: string;
  excerpt: string;
  headingLevel?: number;
  listId?: string;
  listKind?: "bullet" | "ordered";
  ordinal?: number;
  checklist?: boolean;
}

interface StaleEntry {
  id: string;
  previousExcerpt: string;
}

interface OrphanedEntry {
  id: string;
  excerpt: string;
  headingBreadcrumb: string[];
}

interface InitialData {
  sessionKey: string;
  planPath: string;
  blocks: BlockDTO[];
}

type Verdict = "approve" | "request_changes";

interface PendingComment {
  body: string;
  excerpt: string;
  headingBreadcrumb: string[];
  createdAt: number;
}

interface Section {
  id: string;
  headingBlockId: string | null;
  num: string;
  title: string;
  items: BlockDTO[];
}

/* ---------------------------------------------------------- icons (inline, no CDN) */

const ICON_PATHS: Record<string, string> = {
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "message-square":
    '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "circle-check": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
};

function iconSvg(name: string, size = 16): string {
  const inner = ICON_PATHS[name] ?? ICON_PATHS.check;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/* ---------------------------------------------------------- section grouping */

function buildSections(blocks: BlockDTO[]): { pageTitle: string; sections: Section[] } {
  let pageTitle = "";
  const sections: Section[] = [];
  let current: Section | null = null;
  let counter = 0;

  for (const block of blocks) {
    if (block.headingLevel === 1 && !pageTitle) {
      pageTitle = block.headingBreadcrumb[block.headingBreadcrumb.length - 1] ?? block.excerpt;
      continue;
    }
    if (block.headingLevel === 2) {
      counter++;
      current = {
        id: block.id,
        headingBlockId: block.id,
        num: String(counter).padStart(2, "0"),
        title: block.headingBreadcrumb[block.headingBreadcrumb.length - 1] ?? block.excerpt,
        items: [],
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      counter++;
      current = {
        id: `intro-${block.id}`,
        headingBlockId: null,
        num: String(counter).padStart(2, "0"),
        title: "Overview",
        items: [],
      };
      sections.push(current);
    }
    current.items.push(block);
  }

  return { pageTitle, sections };
}

function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/* ---------------------------------------------------------- state */

const dataEl = document.getElementById("gigaplan-data");
const initial: InitialData = JSON.parse(dataEl?.textContent ?? "{}");
const sessionKey = initial.sessionKey;

const state = {
  blocks: initial.blocks ?? [],
  pending: new Map<string, PendingComment>(),
  orphanedPending: new Map<string, PendingComment>(),
  staleIds: new Set<string>(),
  drafts: new Map<string, string>(),
  openComposer: null as string | null,
  collapsed: new Set<string>(),
  reviewed: new Set<string>(),
  verdict: null as Verdict | null,
  globalComment: "",
  submitted: false,
};

let currentSections: Section[] = [];
let currentPageTitle = "";

const appEl = document.getElementById("gp-app") as HTMLElement;

function apiUrl(suffix: string): string {
  return `/api/sessions/${encodeURIComponent(sessionKey)}${suffix}`;
}

function hasAnyComments(): boolean {
  return state.pending.size > 0 || state.orphanedPending.size > 0 || state.globalComment.trim().length > 0;
}

function effectiveVerdict(): Verdict | null {
  if (state.verdict === "request_changes" && !hasAnyComments()) return null;
  return state.verdict;
}

/* ---------------------------------------------------------- comment thread + composer */

function commentThreadHtml(blockId: string): string {
  const parts: string[] = [];
  const comment = state.pending.get(blockId);
  if (state.staleIds.has(blockId) && comment) {
    parts.push('<div class="gp-stale-banner">Content changed since this comment was left.</div>');
  }
  if (comment) {
    parts.push(`
      <div class="gp-thread-comment" data-comment-for="${blockId}">
        <div class="gp-thread-comment-head">
          <span class="cdr-avatar cdr-avatar--sm">${initials("You")}</span>
          <span class="gp-thread-comment-author">You</span>
          <span class="gp-thread-comment-time">${relativeTime(comment.createdAt)}</span>
        </div>
        <div class="gp-thread-comment-body"></div>
        <div class="gp-composer-actions">
          <button type="button" class="cdr-btn cdr-btn--secondary cdr-btn--sm" data-action="edit-comment" data-block-id="${blockId}">Edit</button>
          <button type="button" class="cdr-btn cdr-btn--secondary cdr-btn--sm" data-action="remove-comment" data-block-id="${blockId}">Remove</button>
        </div>
      </div>`);
  }
  if (state.openComposer === blockId) {
    parts.push(`
      <div class="gp-composer" data-composer-for="${blockId}">
        <textarea class="cdr-textarea" data-role="draft" data-block-id="${blockId}" placeholder="Leave a comment…" rows="3"></textarea>
        <div class="gp-composer-actions">
          <button type="button" class="cdr-btn cdr-btn--secondary cdr-btn--sm" data-action="cancel-comment" data-block-id="${blockId}">Cancel</button>
          <button type="button" class="cdr-btn cdr-btn--sm" data-action="save-comment" data-block-id="${blockId}">Comment</button>
        </div>
      </div>`);
  }
  return parts.join("");
}

function commentButtonClasses(blockId: string): string {
  const classes = ["gp-comment-btn"];
  if (state.openComposer === blockId) classes.push("gp-comment-btn--open");
  if (state.pending.has(blockId)) classes.push("gp-comment-btn--active");
  return classes.join(" ");
}

/* ---------------------------------------------------------- item rendering */

function itemContentHtml(block: BlockDTO): string {
  if (block.type === "list_item") {
    if (block.checklist) {
      return `<div class="gp-item-checklist"><span class="cdr-box" aria-hidden="true"></span><span>${block.html}</span></div>`;
    }
    if (block.listKind === "ordered") {
      return `<div class="gp-item-ol"><span class="gp-ordinal">${block.ordinal ?? ""}.</span><span>${block.html}</span></div>`;
    }
    return `<div class="gp-item-ul"><span class="gp-bullet">&bull;</span><span>${block.html}</span></div>`;
  }
  return block.html;
}

function buildCommentableRow(block: BlockDTO): string {
  return `
    <div class="gp-commentable" id="gp-block-${block.id}" data-block-id="${block.id}">
      <div class="gp-commentable-row">
        <div class="gp-commentable-content">${itemContentHtml(block)}</div>
        <button type="button" class="${commentButtonClasses(block.id)}" data-action="toggle-composer" data-block-id="${block.id}" aria-label="Comment on this">
          ${iconSvg("message-square", 14)}
        </button>
      </div>
      <div data-thread-for="${block.id}">${commentThreadHtml(block.id)}</div>
    </div>`;
}

function buildItemsHtml(items: BlockDTO[]): string {
  const html: string[] = [];
  let i = 0;
  while (i < items.length) {
    const block = items[i];
    if (block.type === "hr") {
      html.push('<hr class="gp-hr" />');
      i++;
      continue;
    }
    if (block.type === "list_item" && block.listId) {
      const listId = block.listId;
      const groupEnd = items.findIndex((b, idx) => idx >= i && b.listId !== listId);
      const end = groupEnd === -1 ? items.length : groupEnd;
      for (let j = i; j < end; j++) html.push(buildCommentableRow(items[j]));
      i = end;
      continue;
    }
    html.push(buildCommentableRow(block));
    i++;
  }
  return html.join("");
}

/* ---------------------------------------------------------- sections */

function buildSectionHtml(section: Section): string {
  const collapsed = state.collapsed.has(section.id);
  const reviewed = state.reviewed.has(section.id);
  const commentTotal =
    (section.headingBlockId && state.pending.has(section.headingBlockId) ? 1 : 0) +
    section.items.filter((it) => state.pending.has(it.id)).length;

  const headingCommentBtn = section.headingBlockId
    ? `<button type="button" class="${commentButtonClasses(section.headingBlockId)}" data-action="toggle-composer" data-block-id="${section.headingBlockId}" aria-label="Comment on heading">${iconSvg("message-square", 14)}</button>`
    : "";

  return `
    <div class="gp-section" data-section-id="${section.id}">
      <div class="gp-section-head">
        <button type="button" class="gp-section-collapse" data-action="toggle-collapse" data-section-id="${section.id}" aria-label="Toggle section">
          ${iconSvg(collapsed ? "chevron-right" : "chevron-down")}
        </button>
        <span class="gp-section-num">${section.num}</span>
        <span class="gp-section-title">${section.title}</span>
        ${headingCommentBtn}
        <span class="gp-section-spacer"></span>
        ${commentTotal > 0 ? `<span class="cdr-badge cdr-badge--accent">${commentTotal} comment${commentTotal === 1 ? "" : "s"}</span>` : ""}
        <label class="cdr-choice">
          <input type="checkbox" data-action="toggle-reviewed" data-section-id="${section.id}" ${reviewed ? "checked" : ""} />
          <span class="cdr-box">${iconSvg("check", 13)}</span>
          Reviewed
        </label>
      </div>
      <div class="gp-section-body" data-section-body="${section.id}" ${collapsed ? 'style="display:none"' : ""}>
        ${section.headingBlockId ? `<div data-thread-for="${section.headingBlockId}">${commentThreadHtml(section.headingBlockId)}</div>` : ""}
        ${buildItemsHtml(section.items)}
      </div>
    </div>`;
}

/* ---------------------------------------------------------- top bar */

function buildTopBarHtml(): string {
  const commentCount = state.pending.size + state.orphanedPending.size;
  const status = state.submitted
    ? { tone: "success", label: "Reviewed" }
    : { tone: "warning", label: "Awaiting review" };

  return `
    <div class="gp-topbar">
      <div class="gp-topbar-inner">
        <div class="gp-topbar-row">
          <div class="gp-topbar-heading">
            <span class="gp-topbar-brand">/gigaplan</span>
            <h1 class="gp-topbar-title">${escapeText(currentPageTitle)}</h1>
          </div>
          <span class="cdr-badge cdr-badge--${status.tone} cdr-badge--dot">${status.label}</span>
          <button type="button" class="cdr-iconbtn cdr-iconbtn--solid" data-action="toggle-theme" aria-label="Toggle theme">
            <span data-theme-icon>${iconSvg(document.documentElement.getAttribute("data-theme") === "dark" ? "sun" : "moon", 18)}</span>
          </button>
        </div>
        <div class="gp-topbar-meta">
          <span>${escapeText(currentPlanFilename())} &middot; <span class="gp-mono">${currentSections.length} section${currentSections.length === 1 ? "" : "s"}</span> &middot; <span class="gp-mono">${commentCount} comment${commentCount === 1 ? "" : "s"}</span></span>
        </div>
      </div>
    </div>`;
}

function currentPlanFilename(): string {
  const path = initial.planPath ?? "";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function escapeText(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ---------------------------------------------------------- sidebar */

interface AllCommentEntry {
  blockId: string;
  sectionTitle: string;
  body: string;
  createdAt: number;
}

function collectAllComments(): AllCommentEntry[] {
  const entries: AllCommentEntry[] = [];
  for (const section of currentSections) {
    if (section.headingBlockId) {
      const c = state.pending.get(section.headingBlockId);
      if (c) entries.push({ blockId: section.headingBlockId, sectionTitle: section.title, body: c.body, createdAt: c.createdAt });
    }
    for (const item of section.items) {
      const c = state.pending.get(item.id);
      if (c) entries.push({ blockId: item.id, sectionTitle: section.title, body: c.body, createdAt: c.createdAt });
    }
  }
  for (const [id, c] of state.orphanedPending) {
    entries.push({ blockId: id, sectionTitle: "removed section", body: c.body, createdAt: c.createdAt });
  }
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

function buildSidebarHtml(): string {
  const reviewedCount = currentSections.filter((s) => state.reviewed.has(s.id)).length;
  const total = currentSections.length;
  const pct = total > 0 ? Math.round((reviewedCount / total) * 100) : 0;
  const allComments = collectAllComments();
  const commentCount = state.pending.size + state.orphanedPending.size;

  const commentsHtml =
    allComments.length > 0
      ? allComments
          .map(
            (c) => `
        <div class="gp-comment-row" data-action="jump-to-comment" data-block-id="${c.blockId}">
          <div class="gp-comment-row-head">
            <span class="cdr-avatar cdr-avatar--sm">${initials("You")}</span>
            <span class="gp-comment-row-author">You</span>
            <span class="gp-comment-row-time">${relativeTime(c.createdAt)}</span>
          </div>
          <div class="gp-comment-row-section">${escapeText(c.sectionTitle)}</div>
          <div class="gp-comment-row-text"></div>
        </div>`
          )
          .join("")
      : '<div class="gp-empty-comments">Comments you leave on the plan will show up here, so you can see review coverage at a glance.</div>';

  return `
    <aside class="gp-sidebar">
      <div class="cdr-card gp-coverage-card">
        <div class="ds-eyebrow">// review coverage</div>
        <div class="gp-coverage-numbers">
          <span class="gp-coverage-count">${reviewedCount}</span>
          <span class="gp-coverage-total">of ${total} sections reviewed</span>
        </div>
        <div class="gp-coverage-bar"><div class="gp-coverage-bar-fill" style="width:${pct}%"></div></div>
        <div class="gp-coverage-footer">${commentCount} comment${commentCount === 1 ? "" : "s"} across the plan</div>
      </div>
      <div class="cdr-card">
        <div class="gp-comments-card-head">All comments</div>
        <div>${commentsHtml}</div>
      </div>
    </aside>`;
}

/* ---------------------------------------------------------- finish panel */

function buildFinishPanelHtml(): string {
  const anyComments = hasAnyComments();
  const approveLabel = anyComments ? "Approve with comments" : "Approve";
  const requestChangesDisabled = !anyComments || state.submitted;
  const verdict = effectiveVerdict();
  const cannotSubmit = !verdict || state.submitted;

  if (state.submitted) {
    const verdictLabel = verdict === "approve" ? approveLabel : "Request changes";
    return `
      <div id="gp-finish-panel" class="gp-finish-panel">
        <div class="cdr-card">
          <div class="gp-finish-head">
            <h2 class="gp-finish-title">Review submitted</h2>
          </div>
          <div class="gp-finish-body">
            <div class="cdr-banner cdr-banner--success">
              ${iconSvg("circle-check", 18)}
              <div>
                <div class="cdr-banner-title">Review submitted</div>
                <div class="cdr-banner-body">Verdict: ${verdictLabel}. Revise the plan and reopen this session to review again.</div>
              </div>
            </div>
            ${state.globalComment.trim() ? `<div class="gp-submitted-quote">&ldquo;<span></span>&rdquo;</div>` : ""}
          </div>
        </div>
      </div>`;
  }

  return `
    <div id="gp-finish-panel" class="gp-finish-panel">
      <div class="cdr-card">
        <div class="gp-finish-head">
          <h2 class="gp-finish-title">Finish your review</h2>
        </div>
        <div class="gp-finish-body">
          <div>
            <div class="gp-verdict-label">Your review</div>
            <div class="gp-verdict-options">
              <label class="cdr-choice">
                <input type="radio" name="verdict" data-action="set-verdict" value="approve" ${verdict === "approve" ? "checked" : ""} />
                <span class="cdr-box cdr-box--radio"></span>
                <span data-role="approve-label">${approveLabel}</span>
              </label>
              <label class="cdr-choice ${requestChangesDisabled ? "cdr-choice--disabled" : ""}" data-role="request-changes-choice">
                <input type="radio" name="verdict" data-action="set-verdict" value="request_changes" ${verdict === "request_changes" ? "checked" : ""} ${requestChangesDisabled ? "disabled" : ""} />
                <span class="cdr-box cdr-box--radio"></span>
                Request changes
              </label>
            </div>
            <div class="gp-verdict-hint" data-role="verdict-hint" ${requestChangesDisabled ? "" : 'style="display:none"'}>Leave at least one comment — on a section heading, an item, or below — to request changes.</div>
          </div>
          <textarea class="cdr-textarea" data-role="global-draft" placeholder="Overall feedback for the agent…" rows="4"></textarea>
          <div class="gp-finish-actions">
            <button type="button" class="cdr-btn cdr-btn--lg" data-action="submit-review" ${cannotSubmit ? "disabled" : ""}>Submit review</button>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------- top-level render */

function renderApp(): void {
  const built = buildSections(state.blocks);
  currentSections = built.sections;
  currentPageTitle = built.pageTitle || currentPlanFilename();

  appEl.innerHTML = `
    ${buildTopBarHtml()}
    <div class="gp-body">
      <div class="gp-main-col">${currentSections.map(buildSectionHtml).join("")}</div>
      ${buildSidebarHtml()}
    </div>
    ${buildFinishPanelHtml()}
  `;

  // textContent, never innerHTML, for anything containing a reviewer's own words.
  for (const [blockId, comment] of state.pending) {
    appEl.querySelector(`[data-comment-for="${blockId}"] .gp-thread-comment-body`)!.textContent = comment.body;
  }
  for (const entry of collectAllComments()) {
    const row = appEl.querySelector(`[data-action="jump-to-comment"][data-block-id="${entry.blockId}"] .gp-comment-row-text`);
    if (row) row.textContent = entry.body;
  }
  if (state.submitted && state.globalComment.trim()) {
    const quote = appEl.querySelector(".gp-submitted-quote span");
    if (quote) quote.textContent = state.globalComment.trim();
  }

  // Restore in-progress drafts and focus into any open composer.
  appEl.querySelectorAll<HTMLTextAreaElement>('textarea[data-role="draft"]').forEach((ta) => {
    const blockId = ta.dataset.blockId!;
    ta.value = state.drafts.get(blockId) ?? "";
  });
  const globalTextarea = appEl.querySelector<HTMLTextAreaElement>('textarea[data-role="global-draft"]');
  if (globalTextarea) globalTextarea.value = state.globalComment;
  if (state.openComposer) {
    appEl.querySelector<HTMLTextAreaElement>(`[data-composer-for="${state.openComposer}"] textarea`)?.focus();
  }
}

/* ---------------------------------------------------------- actions */

function openComposer(blockId: string): void {
  state.openComposer = blockId;
  if (!state.drafts.has(blockId)) state.drafts.set(blockId, state.pending.get(blockId)?.body ?? "");
  renderApp();
}

function cancelComposer(blockId: string): void {
  state.openComposer = null;
  state.drafts.delete(blockId);
  renderApp();
}

function saveComment(blockId: string): void {
  const body = (state.drafts.get(blockId) ?? "").trim();
  if (!body) return;
  const block = state.blocks.find((b) => b.id === blockId);
  const existing = state.pending.get(blockId);
  state.pending.set(blockId, {
    body,
    excerpt: block?.excerpt ?? "",
    headingBreadcrumb: block?.headingBreadcrumb ?? [],
    createdAt: existing?.createdAt ?? Date.now(),
  });
  state.openComposer = null;
  state.drafts.delete(blockId);
  renderApp();
}

function removeComment(blockId: string): void {
  state.pending.delete(blockId);
  renderApp();
}

function toggleCollapse(sectionId: string): void {
  const body = appEl.querySelector<HTMLElement>(`[data-section-body="${sectionId}"]`);
  const chevronBtn = appEl.querySelector<HTMLElement>(`[data-action="toggle-collapse"][data-section-id="${sectionId}"]`);
  if (!body || !chevronBtn) return;
  const nowCollapsed = !state.collapsed.has(sectionId);
  if (nowCollapsed) state.collapsed.add(sectionId);
  else state.collapsed.delete(sectionId);
  body.style.display = nowCollapsed ? "none" : "";
  chevronBtn.innerHTML = iconSvg(nowCollapsed ? "chevron-right" : "chevron-down");
}

function toggleReviewed(sectionId: string): void {
  const nowReviewed = !state.reviewed.has(sectionId);
  if (nowReviewed) {
    state.reviewed.add(sectionId);
    state.collapsed.add(sectionId);
  } else {
    state.reviewed.delete(sectionId);
    state.collapsed.delete(sectionId);
  }
  renderApp();
}

function jumpToComment(blockId: string): void {
  const section = currentSections.find((s) => s.headingBlockId === blockId || s.items.some((it) => it.id === blockId));
  if (section && state.collapsed.has(section.id)) {
    state.collapsed.delete(section.id);
    renderApp();
  }
  requestAnimationFrame(() => {
    document.getElementById(`gp-block-${blockId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function setVerdict(v: Verdict): void {
  if (v === "request_changes" && !hasAnyComments()) return;
  state.verdict = v;
  renderApp();
}

// Called on every keystroke in the global-feedback textarea. Patches just the
// verdict controls in place (never renderApp() here) so typing never steals
// focus out of the textarea the reviewer is actively using.
function updateVerdictAvailability(): void {
  const anyComments = hasAnyComments();
  const requestChangesDisabled = !anyComments || state.submitted;

  const approveLabelEl = appEl.querySelector('[data-role="approve-label"]');
  if (approveLabelEl) approveLabelEl.textContent = anyComments ? "Approve with comments" : "Approve";

  const requestInput = appEl.querySelector<HTMLInputElement>(
    'input[data-action="set-verdict"][value="request_changes"]'
  );
  if (requestInput) {
    requestInput.disabled = requestChangesDisabled;
    if (requestChangesDisabled && requestInput.checked) {
      requestInput.checked = false;
      state.verdict = null;
    }
  }
  appEl
    .querySelector('[data-role="request-changes-choice"]')
    ?.classList.toggle("cdr-choice--disabled", requestChangesDisabled);

  const hintEl = appEl.querySelector<HTMLElement>('[data-role="verdict-hint"]');
  if (hintEl) hintEl.style.display = requestChangesDisabled ? "" : "none";

  const submitBtn = appEl.querySelector<HTMLButtonElement>('[data-action="submit-review"]');
  if (submitBtn) submitBtn.disabled = !effectiveVerdict() || state.submitted;
}

function toggleTheme(): void {
  const root = document.documentElement;
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  const iconHost = document.querySelector("[data-theme-icon]");
  if (iconHost) iconHost.innerHTML = iconSvg(next === "dark" ? "sun" : "moon", 18);
}

async function submitReview(): Promise<void> {
  const verdict = effectiveVerdict();
  if (!verdict || state.submitted) return;

  const comments = Array.from(state.pending.entries()).map(([blockId, c]) => ({ blockId, body: c.body }));
  const orphanedText = Array.from(state.orphanedPending.values())
    .map((c) => `[on removed section "${c.headingBreadcrumb.join(" > ") || c.excerpt}"]: ${c.body}`)
    .join("\n\n");
  const globalComment = [state.globalComment.trim(), orphanedText].filter(Boolean).join("\n\n");

  const res = await fetch(apiUrl("/submit"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdict, globalComment, comments }),
  });
  if (!res.ok) return;
  state.submitted = true;
  renderApp();
}

/* ---------------------------------------------------------- event delegation */

appEl.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const blockId = target.dataset.blockId;
  const sectionId = target.dataset.sectionId;

  switch (action) {
    case "toggle-composer":
      if (!blockId) break;
      if (state.openComposer === blockId) cancelComposer(blockId);
      else openComposer(blockId);
      break;
    case "cancel-comment":
      if (blockId) cancelComposer(blockId);
      break;
    case "save-comment":
      if (blockId) saveComment(blockId);
      break;
    case "edit-comment":
      if (blockId) openComposer(blockId);
      break;
    case "remove-comment":
      if (blockId) removeComment(blockId);
      break;
    case "toggle-collapse":
      if (sectionId) toggleCollapse(sectionId);
      break;
    case "jump-to-comment":
      if (blockId) jumpToComment(blockId);
      break;
    case "toggle-theme":
      toggleTheme();
      break;
    case "submit-review":
      submitReview().catch(() => {
        // Leaves the panel interactive so the reviewer can just try again.
      });
      break;
  }
});

appEl.addEventListener("change", (e) => {
  const target = e.target as HTMLElement;
  const action = target.dataset.action;
  if (action === "toggle-reviewed" && target.dataset.sectionId) {
    toggleReviewed(target.dataset.sectionId);
  } else if (action === "set-verdict" && target instanceof HTMLInputElement) {
    setVerdict(target.value as Verdict);
  }
});

appEl.addEventListener("input", (e) => {
  const target = e.target as HTMLElement;
  if (target.dataset.role === "draft" && target.dataset.blockId && target instanceof HTMLTextAreaElement) {
    state.drafts.set(target.dataset.blockId, target.value);
  } else if (target.dataset.role === "global-draft" && target instanceof HTMLTextAreaElement) {
    state.globalComment = target.value;
    updateVerdictAvailability();
  }
});

/* ---------------------------------------------------------- live-reload */

async function fetchAndReconcile(): Promise<void> {
  const res = await fetch(apiUrl("/blocks"));
  if (!res.ok) return;
  const data = (await res.json()) as { blocks: BlockDTO[]; stale: StaleEntry[]; orphaned: OrphanedEntry[] };

  const newIds = new Set(data.blocks.map((b) => b.id));
  for (const [id, comment] of Array.from(state.pending.entries())) {
    if (!newIds.has(id)) {
      state.orphanedPending.set(id, comment);
      state.pending.delete(id);
    }
  }
  for (const o of data.orphaned) {
    const existing = state.pending.get(o.id);
    if (existing) {
      state.orphanedPending.set(o.id, existing);
      state.pending.delete(o.id);
    }
  }

  state.staleIds.clear();
  for (const s of data.stale) state.staleIds.add(s.id);

  state.blocks = data.blocks;
  renderApp();
}

function connectSSE(): void {
  const source = new EventSource(apiUrl("/events"));
  source.addEventListener("changed", () => {
    fetchAndReconcile().catch(() => {
      // Live-reload is best-effort; the reviewer can still submit against what's on screen.
    });
  });
}

renderApp();
connectSSE();
