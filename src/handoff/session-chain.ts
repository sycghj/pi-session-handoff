/**
 * session-chain.ts — Walk the `parentSession` chain recorded in session headers.
 *
 * A Pi session file starts with a header line
 * (`{"type":"session","id":…,"cwd":…,"parentSession":…}`). Sessions created by
 * `/fork`, `/clone`, `newSession({ parentSession })`, or a handoff record the
 * session they came from, so the chain can be walked backwards from the
 * current session without parsing any conversation entries.
 */

import { closeSync, openSync, readSync } from "node:fs";

/** Header fields of a session that the chain walk needs. */
export interface SessionChainNode {
  /** Absolute path of the session file. */
  file: string;
  /** Session id from the header. */
  id: string;
  /** Working directory the session was launched in. */
  cwd: string;
  /** Path of the session this one descends from, when recorded. */
  parentSession: string | undefined;
}

/**
 * Bytes read when scanning a session header. The header is the file's first
 * line and is a few hundred bytes; a bounded read keeps a chain walk over
 * multi-megabyte ancestors cheap.
 */
const HEADER_CHUNK_BYTES = 64 * 1024;

/** Hard cap on how far a chain walk follows `parentSession`. */
export const MAX_CHAIN_DEPTH = 50;

/**
 * Read a session file's header, or `undefined` when the file is missing,
 * unreadable, or does not start with a session header line.
 */
export function readSessionHeader(file: string): SessionChainNode | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(HEADER_CHUNK_BYTES);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead <= 0) return undefined;

    const firstLine = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .split("\n")[0]
      ?.trim();
    if (!firstLine) return undefined;

    const parsed = JSON.parse(firstLine) as Record<string, unknown>;
    if (parsed.type !== "session") return undefined;
    if (typeof parsed.id !== "string" || parsed.id.length === 0)
      return undefined;

    return {
      file,
      id: parsed.id,
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
      parentSession:
        typeof parsed.parentSession === "string"
          ? parsed.parentSession
          : undefined,
    };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Walk the chain from `currentFile` towards the oldest ancestor.
 *
 * The returned array starts with the current session. A missing or malformed
 * session file ends the walk, as does a repeated file (a cycle) or
 * `maxDepth` entries.
 */
export function walkSessionChain(
  currentFile: string,
  options: { maxDepth?: number } = {},
): SessionChainNode[] {
  const maxDepth = options.maxDepth ?? MAX_CHAIN_DEPTH;
  const chain: SessionChainNode[] = [];
  const seen = new Set<string>();

  let next: string | undefined = currentFile;
  while (next !== undefined && chain.length < maxDepth && !seen.has(next)) {
    seen.add(next);
    const node = readSessionHeader(next);
    if (!node) break;
    chain.push(node);
    next = node.parentSession;
  }

  return chain;
}
