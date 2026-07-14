import { diffSinceSnapshot } from "./markdown.js";
import type {
  Block,
  EnrichedComment,
  ReconcileResult,
  Review,
  SinceReviewDiff,
  SubmittedComment,
  Verdict,
} from "./types.js";

interface Waiter {
  resolve: (review: Review | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface SessionRuntime {
  blocks: Block[];
  reviews: Review[];
  nextReviewId: number;
  waiters: Waiter[];
  lastReconciliation: { stale: Map<string, string>; orphaned: ReconcileResult["orphaned"] };
  /** Blocks as they stood at the last submitted review; null until a review
   * has been submitted, so `getSinceReviewDiff` has nothing to show yet. */
  sinceReviewSnapshot: Block[] | null;
}

const runtimes = new Map<string, SessionRuntime>();

function getRuntime(planPath: string): SessionRuntime {
  let runtime = runtimes.get(planPath);
  if (!runtime) {
    runtime = {
      blocks: [],
      reviews: [],
      nextReviewId: 0,
      waiters: [],
      lastReconciliation: { stale: new Map(), orphaned: [] },
      sinceReviewSnapshot: null,
    };
    runtimes.set(planPath, runtime);
  }
  return runtime;
}

export function setBlocks(planPath: string, blocks: Block[]): void {
  getRuntime(planPath).blocks = blocks;
}

export function getBlocks(planPath: string): Block[] {
  return getRuntime(planPath).blocks;
}

export function applyReconciliation(planPath: string, result: ReconcileResult): void {
  const runtime = getRuntime(planPath);
  runtime.blocks = result.blocks;
  runtime.lastReconciliation = {
    stale: new Map(result.stale.map((s) => [s.id, s.previousExcerpt])),
    orphaned: result.orphaned,
  };
}

export function getLastReconciliation(planPath: string) {
  return getRuntime(planPath).lastReconciliation;
}

export function getSinceReviewDiff(planPath: string): SinceReviewDiff {
  const runtime = getRuntime(planPath);
  if (!runtime.sinceReviewSnapshot) return { updated: [], added: [], removedCount: 0 };
  return diffSinceSnapshot(runtime.sinceReviewSnapshot, runtime.blocks);
}

export function submitReview(
  planPath: string,
  verdict: Verdict,
  globalComment: string,
  comments: SubmittedComment[]
): Review {
  const runtime = getRuntime(planPath);
  const blockById = new Map(runtime.blocks.map((b) => [b.id, b]));
  const staleIds = runtime.lastReconciliation.stale;

  const enriched: EnrichedComment[] = comments.map((c) => {
    const block = blockById.get(c.blockId);
    return {
      blockId: c.blockId,
      headingBreadcrumb: block?.headingBreadcrumb ?? [],
      excerpt: block?.excerpt ?? "",
      body: c.body,
      stale: staleIds.has(c.blockId),
    };
  });

  const review: Review = {
    reviewId: ++runtime.nextReviewId,
    verdict,
    globalComment,
    comments: enriched,
    submittedAt: new Date().toISOString(),
  };
  runtime.reviews.push(review);
  runtime.lastReconciliation = { stale: new Map(), orphaned: [] };
  runtime.sinceReviewSnapshot = runtime.blocks.slice();

  const waiters = runtime.waiters.splice(0, runtime.waiters.length);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(review);
  }

  return review;
}

export function latestReview(planPath: string): Review | undefined {
  const runtime = getRuntime(planPath);
  return runtime.reviews[runtime.reviews.length - 1];
}

export function pollReview(
  planPath: string,
  sinceReviewId: number,
  timeoutMs: number
): Promise<Review | null> {
  const runtime = getRuntime(planPath);
  const existing = runtime.reviews.find((r) => r.reviewId > sinceReviewId);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const index = runtime.waiters.findIndex((w) => w.resolve === resolveOnce);
      if (index !== -1) runtime.waiters.splice(index, 1);
      resolve(null);
    }, timeoutMs);
    function resolveOnce(review: Review | null): void {
      resolve(review);
    }
    runtime.waiters.push({ resolve: resolveOnce, timer });
  });
}
