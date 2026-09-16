/**
 * target.ts — Where a handoff document is stored.
 *
 * Handoff documents live in a `handoffs/` subdirectory of the session storage
 * directory, next to the session files they describe. That keeps them off the
 * project tree while leaving them beside the session chain they reference.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Subdirectory of the session storage directory that holds handoff documents. */
export const HANDOFF_DIR_NAME = "handoffs";

export interface HandoffTarget {
  /** Directory holding handoff documents for this session storage directory. */
  dir: string;
  /** Absolute path of the handoff document. */
  file: string;
}

/**
 * Resolve the handoff document path for a session.
 *
 * The file name mirrors Pi's own session file naming
 * (`<timestamp>_<sessionId>.md`) so a handoff sorts alongside the session it
 * was taken from.
 */
export function resolveHandoffTarget(options: {
  sessionDir: string;
  sessionId: string;
  now?: Date;
}): HandoffTarget {
  const dir = join(options.sessionDir, HANDOFF_DIR_NAME);
  const stamp = formatFileTimestamp(options.now ?? new Date());
  return { dir, file: join(dir, `${stamp}_${options.sessionId}.md`) };
}

/** Render an ISO timestamp in a filesystem-safe form (`:` and `.` become `-`). */
export function formatFileTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

/** Create the handoff directory (and its parents) when it does not exist yet. */
export function ensureHandoffDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
