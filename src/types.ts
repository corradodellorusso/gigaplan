export type Verdict = "approve" | "request_changes" | "comment";

export type BlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "fence"
  | "table"
  | "blockquote"
  | "hr";

export interface Block {
  id: string;
  hash: string;
  type: BlockType;
  headingBreadcrumb: string[];
  html: string;
  excerpt: string;
  headingLevel?: number;
  /** Set on `list_item` blocks: which source list they belong to, so the
   * renderer can group consecutive items back into one <ul>/<ol>. */
  listId?: string;
  listKind?: "bullet" | "ordered";
  /** 1-based position within an ordered list. */
  ordinal?: number;
  /** True when the item used GFM task-list syntax (`- [ ] ...` / `- [x] ...`). */
  checklist?: boolean;
  /** Set on `fence` blocks with a language tag (lowercased first word of the
   * fence info string), e.g. "js" for ` ```js `. Unset for untagged fences. */
  language?: string;
}

export interface EnrichedComment {
  blockId: string;
  headingBreadcrumb: string[];
  excerpt: string;
  body: string;
  stale: boolean;
}

export interface SubmittedComment {
  blockId: string;
  body: string;
}

export interface Review {
  reviewId: number;
  verdict: Verdict;
  globalComment: string;
  comments: EnrichedComment[];
  submittedAt: string;
}

export interface ReconcileResult {
  blocks: Block[];
  stale: { id: string; previousExcerpt: string }[];
  orphaned: { id: string; excerpt: string; headingBreadcrumb: string[] }[];
}

/** Diff of the current blocks against the snapshot taken at the reviewer's
 * last submitted review — drives the "what changed since you last looked"
 * highlight, distinct from `ReconcileResult.stale`/`orphaned` (which track
 * changes since the last file save, for protecting in-progress comments). */
export interface SinceReviewDiff {
  updated: string[];
  added: string[];
  removedCount: number;
}

export interface SessionRecord {
  planPath: string;
  createdAt: string;
  ended: boolean;
  reopenable: boolean;
  /** Highest reviewId the CLI's `poll` command has already returned to the agent. */
  lastPolledReviewId: number;
  /** True once `gigaplan review` has actually opened a browser tab for this
   * session at least once — later `review` calls for the same path skip
   * opening another tab and rely on the existing one's own live-reload. */
  browserOpened: boolean;
}

export interface ServerLock {
  pid: number;
  port: number;
}
