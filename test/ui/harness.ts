import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, "server-entry.ts");

// One hour: comfortably longer than any test run, so the server's own
// idle-timeout (which calls process.exit(0)) never fires mid-suite. The
// child-process isolation below is the real safety net for that; this is
// belt-and-suspenders.
const IDLE_TIMEOUT_MS = String(60 * 60 * 1000);

export interface ReviewPoll {
  reviewId: number;
  verdict: "approve" | "request_changes";
  globalComment: string;
  comments: Array<{
    blockId: string;
    headingBreadcrumb: string[];
    excerpt: string;
    body: string;
    stale: boolean;
  }>;
  submittedAt: string;
}

export interface UiSession {
  page: Page;
  browser: Browser;
  planPath: string;
  sessionUrl: string;
  poll: (since?: number) => Promise<ReviewPoll | null>;
  cleanup: () => Promise<void>;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function waitForReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer): void => {
      buf += chunk.toString();
      if (/\{"port":\d+\}/.test(buf)) {
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.on("exit", (code) => reject(new Error(`server-entry exited early (code ${code}): ${buf}`)));
  });
}

/**
 * Spins up an isolated gigaplan server (its own child process, its own
 * GIGAPLAN_HOME temp dir, an OS-assigned free port) and opens `fixturePath`
 * in a fresh, disposable Playwright-launched Chromium instance — never the
 * caller's actual installed browser.
 */
export async function startUiSession(fixturePath: string): Promise<UiSession> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gigaplan-ui-home-"));
  const planPath = path.resolve(fixturePath);
  const port = await getFreePort();

  const child = spawn(process.execPath, ["--import", "tsx", SERVER_ENTRY], {
    env: {
      ...process.env,
      GIGAPLAN_HOME: tmpHome,
      GIGAPLAN_PORT: String(port),
      GIGAPLAN_IDLE_TIMEOUT_MS: IDLE_TIMEOUT_MS,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(child);

  const base = `http://127.0.0.1:${port}`;
  const createRes = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planPath }),
  });
  const { url } = (await createRes.json()) as { url: string };

  const browser = await chromium.launch();
  // The "Copy" button on code fences uses navigator.clipboard.writeText,
  // which silently no-ops without this permission granted.
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load" });

  return {
    page,
    browser,
    planPath,
    sessionUrl: url,
    poll: async (since = 0) => {
      const res = await fetch(
        `${base}/api/sessions/${encodeURIComponent(planPath)}/poll?since=${since}`
      );
      if (res.status === 204) return null;
      return (await res.json()) as ReviewPoll;
    },
    cleanup: async () => {
      await browser.close();
      child.kill();
      fs.rmSync(tmpHome, { recursive: true, force: true });
    },
  };
}
