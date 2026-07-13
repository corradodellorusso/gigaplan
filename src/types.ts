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

export interface SessionRecord {
  planPath: string;
  createdAt: string;
  ended: boolean;
  reopenable: boolean;
  /** Highest reviewId the CLI's `poll` command has already returned to the agent. */
  lastPolledReviewId: number;
}

export interface ServerLock {
  pid: number;
  port: number;
}
