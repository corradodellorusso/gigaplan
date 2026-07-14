import * as fs from "node:fs";
import { STATE_DIR, STATE_FILE, SERVER_LOCK_FILE } from "./paths.js";
import type { SessionRecord, ServerLock } from "./types.js";

interface StateFile {
  sessions: Record<string, SessionRecord>;
}

function ensureStateDir(): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readState(): StateFile {
  ensureStateDir();
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    return JSON.parse(raw) as StateFile;
  } catch {
    return { sessions: {} };
  }
}

function writeState(state: StateFile): void {
  ensureStateDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export function getSession(planPath: string): SessionRecord | undefined {
  return readState().sessions[planPath];
}

export function createOrReopenSession(planPath: string): SessionRecord {
  const state = readState();
  const existing = state.sessions[planPath];
  if (existing) {
    existing.ended = false;
    writeState(state);
    return existing;
  }
  const record: SessionRecord = {
    planPath,
    createdAt: new Date().toISOString(),
    ended: false,
    reopenable: true,
    lastPolledReviewId: 0,
    browserOpened: false,
  };
  state.sessions[planPath] = record;
  writeState(state);
  return record;
}

/** Marks a session's browser tab as opened, returning whether it was already
 * marked opened before this call (i.e. whether the caller should skip
 * actually opening another tab). */
export function markBrowserOpened(planPath: string): boolean {
  const state = readState();
  const existing = state.sessions[planPath];
  if (!existing) return false;
  const alreadyOpened = existing.browserOpened === true;
  existing.browserOpened = true;
  writeState(state);
  return alreadyOpened;
}

export function endSession(planPath: string): SessionRecord | undefined {
  const state = readState();
  const existing = state.sessions[planPath];
  if (!existing) return undefined;
  existing.ended = true;
  existing.reopenable = true;
  writeState(state);
  return existing;
}

export function bumpLastPolledReviewId(planPath: string, reviewId: number): void {
  const state = readState();
  const existing = state.sessions[planPath];
  if (!existing) return;
  existing.lastPolledReviewId = reviewId;
  writeState(state);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readServerLock(): ServerLock | undefined {
  try {
    const raw = fs.readFileSync(SERVER_LOCK_FILE, "utf8");
    const lock = JSON.parse(raw) as ServerLock;
    if (isProcessAlive(lock.pid)) return lock;
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeServerLock(lock: ServerLock): void {
  ensureStateDir();
  fs.writeFileSync(SERVER_LOCK_FILE, JSON.stringify(lock, null, 2), "utf8");
}

export function clearServerLock(): void {
  try {
    fs.unlinkSync(SERVER_LOCK_FILE);
  } catch {
    // already gone
  }
}
