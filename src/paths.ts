import * as os from "node:os";
import * as path from "node:path";

export const STATE_DIR = path.join(os.homedir(), ".gigaplan");
export const STATE_FILE = path.join(STATE_DIR, "state.json");
export const SERVER_LOCK_FILE = path.join(STATE_DIR, "server.json");

export const DEFAULT_PORT = 4873;
export const PORT = Number(process.env.GIGAPLAN_PORT) || DEFAULT_PORT;

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_TIMEOUT_MS =
  Number(process.env.GIGAPLAN_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT_MS;

export const LONG_POLL_TIMEOUT_MS = 60_000;

export function canonicalPlanPath(inputPath: string): string {
  return path.resolve(process.cwd(), inputPath);
}
