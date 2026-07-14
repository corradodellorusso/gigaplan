import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import open from "open";
import { canonicalPlanPath, PORT, LONG_POLL_TIMEOUT_MS } from "./paths.js";
import {
  readServerLock,
  getSession,
  bumpLastPolledReviewId,
  isProcessAlive,
  clearServerLock,
} from "./session-store.js";
import type { Review } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printUsage(): void {
  console.log(
    [
      "Usage: gigaplan <command> <path-to-plan.md>",
      "",
      "Commands:",
      "  review <path>   Open (or reuse) the browser review session for this plan file",
      "  poll <path>     Block until a review is submitted; print it as compact markdown",
      "  end <path>      Mark the review session done",
      "  stop            Stop the shared local gigaplan server, if one is running",
    ].join("\n")
  );
}

function requestJson<T>(
  method: string,
  urlPath: string,
  body?: unknown,
  timeoutMs = 10_000
): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: urlPath,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status === 204 || text.length === 0) {
            resolve({ status, body: undefined as T });
            return;
          }
          try {
            resolve({ status, body: JSON.parse(text) as T });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    if (payload) req.write(payload);
    req.end();
  });
}

async function ensureServerRunning(): Promise<void> {
  const existing = readServerLock();
  if (existing) return;

  const serverEntry = path.join(__dirname, "server.js");
  const child = spawn(process.execPath, [serverEntry], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Wait for the freshly spawned server to bind and write its lock file.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (readServerLock()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("gigaplan server did not start in time");
}

async function cmdReview(rawPath: string | undefined): Promise<void> {
  if (!rawPath) {
    console.error("gigaplan review: missing <path-to-plan.md>");
    process.exitCode = 1;
    return;
  }
  const planPath = canonicalPlanPath(rawPath);
  if (!fs.existsSync(planPath)) {
    console.error(`gigaplan review: plan file not found: ${planPath}`);
    process.exitCode = 1;
    return;
  }

  await ensureServerRunning();
  const { status, body } = await requestJson<{
    sessionKey: string;
    url: string;
    alreadyOpened?: boolean;
    error?: string;
  }>("POST", "/api/sessions", { planPath });
  if (status !== 200) {
    console.error(`gigaplan review: ${body.error ?? "failed to create session"}`);
    process.exitCode = 1;
    return;
  }

  if (body.alreadyOpened) {
    // A tab for this session was already opened at some point; the plan file
    // watcher + SSE live-reload will push the latest content to it directly,
    // so opening another tab here would just leave a stale duplicate behind.
    console.log(`Review session updated (already open in your browser): ${body.url}`);
    return;
  }
  await open(body.url);
  console.log(`Opened for review: ${body.url}`);
}

function verdictTitle(verdict: string): string {
  if (verdict === "approve") return "approved";
  if (verdict === "request_changes") return "request changes";
  return "comment";
}

function formatReviewAsMarkdown(review: Review): string {
  const lines: string[] = [];
  lines.push(`# Review: ${verdictTitle(review.verdict)}`);
  lines.push("");
  lines.push("## Overall comment");
  lines.push(review.globalComment.trim().length > 0 ? review.globalComment.trim() : "(none)");

  if (review.comments.length > 0) {
    lines.push("");
    lines.push("## Comments");
    for (const comment of review.comments) {
      const breadcrumb = comment.headingBreadcrumb.join(" > ") || comment.excerpt || comment.blockId;
      lines.push(`### On "${breadcrumb}"`);
      if (comment.stale) {
        lines.push("_(content at this location changed since this comment was left)_");
      }
      lines.push(comment.body);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

async function cmdPoll(rawPath: string | undefined): Promise<void> {
  if (!rawPath) {
    console.error("gigaplan poll: missing <path-to-plan.md>");
    process.exitCode = 1;
    return;
  }
  const planPath = canonicalPlanPath(rawPath);
  if (!readServerLock()) {
    console.error("gigaplan poll: no gigaplan server is running; run `gigaplan review <path>` first");
    process.exitCode = 1;
    return;
  }

  const sessionKey = encodeURIComponent(planPath);
  const since = getSession(planPath)?.lastPolledReviewId ?? 0;
  for (;;) {
    const { status, body } = await requestJson<Review>(
      "GET",
      `/api/sessions/${sessionKey}/poll?since=${since}`,
      undefined,
      LONG_POLL_TIMEOUT_MS + 5000
    );
    if (status === 204) continue;
    bumpLastPolledReviewId(planPath, body.reviewId);
    process.stdout.write(formatReviewAsMarkdown(body));
    return;
  }
}

async function cmdEnd(rawPath: string | undefined): Promise<void> {
  if (!rawPath) {
    console.error("gigaplan end: missing <path-to-plan.md>");
    process.exitCode = 1;
    return;
  }
  const planPath = canonicalPlanPath(rawPath);
  const sessionKey = encodeURIComponent(planPath);
  const { status } = await requestJson("POST", `/api/sessions/${sessionKey}/end`, {});
  if (status !== 200) {
    console.error(`gigaplan end: no session found for ${planPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Review session ended for ${planPath}`);
}

async function cmdStop(): Promise<void> {
  const lock = readServerLock();
  if (!lock) {
    console.log("gigaplan stop: no server is running");
    return;
  }

  try {
    await requestJson("POST", "/api/shutdown", {}, 3000);
  } catch {
    // The server may tear down its connection mid-response as it exits;
    // that's expected. Fall through and confirm it's actually gone below.
  }

  const deadline = Date.now() + 3000;
  while (isProcessAlive(lock.pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isProcessAlive(lock.pid)) {
    // The graceful path didn't take (e.g. a wedged event loop); force it.
    process.kill(lock.pid, "SIGTERM");
    clearServerLock();
  }
  console.log(`Stopped gigaplan server (pid ${lock.pid}).`);
}

export function main(): void {
  const [, , command, arg] = process.argv;
  const run = async (): Promise<void> => {
    switch (command) {
      case "review":
        await cmdReview(arg);
        break;
      case "poll":
        await cmdPoll(arg);
        break;
      case "end":
        await cmdEnd(arg);
        break;
      case "stop":
        await cmdStop();
        break;
      default:
        printUsage();
        if (command) process.exitCode = 1;
    }
  };
  run().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exitCode = 1;
  });
}
