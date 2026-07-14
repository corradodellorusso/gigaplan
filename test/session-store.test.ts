import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Point GIGAPLAN's state dir at a throwaway temp dir before importing the module,
// since paths.ts resolves STATE_DIR at import time from os.homedir().
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "gigaplan-test-"));
process.env.HOME = tmpHome;

const {
  createOrReopenSession,
  getSession,
  endSession,
  bumpLastPolledReviewId,
  markBrowserOpened,
  readServerLock,
  writeServerLock,
  clearServerLock,
} = await import("../src/session-store.js");

test("createOrReopenSession creates a new session record", () => {
  const planPath = "/tmp/plan-a.md";
  const record = createOrReopenSession(planPath);
  assert.equal(record.planPath, planPath);
  assert.equal(record.ended, false);
  assert.equal(record.lastPolledReviewId, 0);
  assert.equal(getSession(planPath)?.planPath, planPath);
});

test("createOrReopenSession is idempotent and reopens an ended session", () => {
  const planPath = "/tmp/plan-b.md";
  createOrReopenSession(planPath);
  endSession(planPath);
  assert.equal(getSession(planPath)?.ended, true);

  const reopened = createOrReopenSession(planPath);
  assert.equal(reopened.ended, false);
});

test("markBrowserOpened reports false only the first time, then true on every later call", () => {
  const planPath = "/tmp/plan-d.md";
  createOrReopenSession(planPath);
  assert.equal(getSession(planPath)?.browserOpened, false);

  assert.equal(markBrowserOpened(planPath), false);
  assert.equal(getSession(planPath)?.browserOpened, true);
  assert.equal(markBrowserOpened(planPath), true);

  // Ending and reopening the session (e.g. a later `gigaplan review` call
  // after `end`) must not forget that a tab was already opened for it.
  endSession(planPath);
  createOrReopenSession(planPath);
  assert.equal(markBrowserOpened(planPath), true);
});

test("bumpLastPolledReviewId persists the review id", () => {
  const planPath = "/tmp/plan-c.md";
  createOrReopenSession(planPath);
  bumpLastPolledReviewId(planPath, 3);
  assert.equal(getSession(planPath)?.lastPolledReviewId, 3);
});

test("server lock round-trips and detects a dead pid as absent", () => {
  writeServerLock({ pid: process.pid, port: 4873 });
  const lock = readServerLock();
  assert.equal(lock?.pid, process.pid);
  assert.equal(lock?.port, 4873);

  // A pid that is astronomically unlikely to be alive.
  writeServerLock({ pid: 999999, port: 4873 });
  assert.equal(readServerLock(), undefined);

  clearServerLock();
  assert.equal(readServerLock(), undefined);
});
