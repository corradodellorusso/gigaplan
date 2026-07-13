import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import chokidar from "chokidar";
import { parseBlocks, reconcileBlocks } from "./markdown.js";
import { renderSessionPage } from "./render.js";
import * as sessionStore from "./session-store.js";
import * as reviewStore from "./review-store.js";
import { PORT, LONG_POLL_TIMEOUT_MS, IDLE_TIMEOUT_MS } from "./paths.js";
import type { SubmittedComment, Verdict } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const watchers = new Map<string, ReturnType<typeof chokidar.watch>>();
const sseClients = new Map<string, express.Response[]>();

function watchPlan(planPath: string): void {
  if (watchers.has(planPath)) return;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const watcher = chokidar.watch(planPath, { ignoreInitial: true });
  watcher.on("change", () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        const source = fs.readFileSync(planPath, "utf8");
        const freshBlocks = parseBlocks(source);
        const oldBlocks = reviewStore.getBlocks(planPath);
        const result = reconcileBlocks(oldBlocks, freshBlocks);
        reviewStore.applyReconciliation(planPath, result);
        notifySse(planPath);
      } catch {
        // The plan file may be transiently unreadable mid-write (editors that
        // truncate-then-write); the next change event will settle it.
      }
    }, 150);
  });
  watchers.set(planPath, watcher);
}

function notifySse(planPath: string): void {
  const clients = sseClients.get(planPath) ?? [];
  for (const res of clients) {
    res.write("event: changed\ndata: {}\n\n");
  }
}

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/public", express.static(path.join(__dirname, "..", "public")));

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const onIdleTimeout = (): void => {
    sessionStore.clearServerLock();
    process.exit(0);
  };
  app.use((_req, _res, next) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdleTimeout, IDLE_TIMEOUT_MS);
    next();
  });

  app.post("/api/sessions", (req, res) => {
    const { planPath } = req.body as { planPath?: string };
    if (!planPath) {
      res.status(400).json({ error: "planPath is required" });
      return;
    }
    if (!fs.existsSync(planPath)) {
      res.status(404).json({ error: `plan file not found: ${planPath}` });
      return;
    }

    sessionStore.createOrReopenSession(planPath);
    const source = fs.readFileSync(planPath, "utf8");
    reviewStore.setBlocks(planPath, parseBlocks(source));
    watchPlan(planPath);

    const sessionKey = encodeURIComponent(planPath);
    res.json({ sessionKey: planPath, url: `http://127.0.0.1:${PORT}/session/${sessionKey}` });
  });

  app.get("/session/:key", (req, res) => {
    const planPath = req.params.key;
    const session = sessionStore.getSession(planPath);
    if (!session) {
      res
        .status(404)
        .send("No gigaplan session for this plan file. Run `gigaplan review <path>` first.");
      return;
    }
    const blocks = reviewStore.getBlocks(planPath);
    res.type("html").send(renderSessionPage(planPath, planPath, blocks));
  });

  app.get("/api/sessions/:key/blocks", (req, res) => {
    const planPath = req.params.key;
    const blocks = reviewStore.getBlocks(planPath);
    const recon = reviewStore.getLastReconciliation(planPath);
    res.json({
      blocks,
      stale: Array.from(recon.stale.entries()).map(([id, previousExcerpt]) => ({
        id,
        previousExcerpt,
      })),
      orphaned: recon.orphaned,
    });
  });

  app.get("/api/sessions/:key/events", (req, res) => {
    const planPath = req.params.key;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    const list = sseClients.get(planPath) ?? [];
    list.push(res);
    sseClients.set(planPath, list);
    req.on("close", () => {
      const arr = sseClients.get(planPath) ?? [];
      const idx = arr.indexOf(res);
      if (idx !== -1) arr.splice(idx, 1);
    });
  });

  app.post("/api/sessions/:key/submit", (req, res) => {
    const planPath = req.params.key;
    const { verdict, globalComment, comments } = req.body as {
      verdict: Verdict;
      globalComment?: string;
      comments?: SubmittedComment[];
    };
    const review = reviewStore.submitReview(planPath, verdict, globalComment ?? "", comments ?? []);
    res.json({ ok: true, reviewId: review.reviewId });
  });

  app.get("/api/sessions/:key/poll", async (req, res) => {
    const planPath = req.params.key;
    const since = Number(req.query.since) || 0;
    const review = await reviewStore.pollReview(planPath, since, LONG_POLL_TIMEOUT_MS);
    if (!review) {
      res.status(204).end();
      return;
    }
    res.json(review);
  });

  app.post("/api/sessions/:key/end", (req, res) => {
    const planPath = req.params.key;
    const session = sessionStore.endSession(planPath);
    if (!session) {
      res.status(404).json({ error: "no such session" });
      return;
    }
    res.json({ ok: true });
  });

  return app;
}

function startServer(): void {
  const app = createApp();
  const server = app.listen(PORT, "127.0.0.1", () => {
    sessionStore.writeServerLock({ pid: process.pid, port: PORT });
  });
  server.on("error", (err) => {
    console.error(`gigaplan server failed to start: ${String(err)}`);
    process.exit(1);
  });
}

if (process.argv[1] === __filename) {
  startServer();
}
