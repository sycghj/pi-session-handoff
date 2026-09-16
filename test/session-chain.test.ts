import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_CHAIN_DEPTH,
  readSessionHeader,
  walkSessionChain,
} from "../src/handoff/session-chain.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "handoff-chain-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSession(name: string, header: Record<string, unknown>): string {
  const file = join(dir, name);
  writeFileSync(
    file,
    `${JSON.stringify(header)}\n${JSON.stringify({ type: "message", id: "m1" })}\n`,
  );
  return file;
}

describe("readSessionHeader", () => {
  it("reads the header from the first line only", () => {
    const file = writeSession("a.jsonl", {
      type: "session",
      version: 3,
      id: "session-a",
      timestamp: "2026-09-16T00:00:00.000Z",
      cwd: "/work/project",
      parentSession: "/work/parent.jsonl",
    });

    expect(readSessionHeader(file)).toEqual({
      file,
      id: "session-a",
      cwd: "/work/project",
      parentSession: "/work/parent.jsonl",
    });
  });

  it("omits parentSession when the header has none", () => {
    const file = writeSession("root.jsonl", {
      type: "session",
      id: "session-root",
      cwd: "/work",
    });

    expect(readSessionHeader(file)?.parentSession).toBeUndefined();
  });

  it("returns undefined for a missing file", () => {
    expect(readSessionHeader(join(dir, "missing.jsonl"))).toBeUndefined();
  });

  it("returns undefined when the first line is not a session header", () => {
    const file = join(dir, "not-a-session.jsonl");
    writeFileSync(file, `${JSON.stringify({ type: "message", id: "m1" })}\n`);

    expect(readSessionHeader(file)).toBeUndefined();
  });

  it("returns undefined for a malformed first line", () => {
    const file = join(dir, "broken.jsonl");
    writeFileSync(file, "not json at all\n");

    expect(readSessionHeader(file)).toBeUndefined();
  });

  it("returns undefined for an empty file", () => {
    const file = join(dir, "empty.jsonl");
    writeFileSync(file, "");

    expect(readSessionHeader(file)).toBeUndefined();
  });
});

describe("walkSessionChain", () => {
  it("collects the current session and its ancestors, nearest first", () => {
    const root = writeSession("root.jsonl", {
      type: "session",
      id: "root",
      cwd: "/work",
    });
    const middle = writeSession("middle.jsonl", {
      type: "session",
      id: "middle",
      cwd: "/work",
      parentSession: root,
    });
    const current = writeSession("current.jsonl", {
      type: "session",
      id: "current",
      cwd: "/work",
      parentSession: middle,
    });

    expect(walkSessionChain(current).map((node) => node.id)).toEqual([
      "current",
      "middle",
      "root",
    ]);
  });

  it("stops at a session whose parent file is gone", () => {
    const current = writeSession("current.jsonl", {
      type: "session",
      id: "current",
      cwd: "/work",
      parentSession: join(dir, "deleted.jsonl"),
    });

    expect(walkSessionChain(current).map((node) => node.id)).toEqual([
      "current",
    ]);
  });

  it("returns an empty chain when the current session file cannot be read", () => {
    expect(walkSessionChain(join(dir, "missing.jsonl"))).toEqual([]);
  });

  it("stops instead of looping when the chain is cyclic", () => {
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    writeFileSync(
      a,
      `${JSON.stringify({ type: "session", id: "a", cwd: "/work", parentSession: b })}\n`,
    );
    writeFileSync(
      b,
      `${JSON.stringify({ type: "session", id: "b", cwd: "/work", parentSession: a })}\n`,
    );

    expect(walkSessionChain(a).map((node) => node.id)).toEqual(["a", "b"]);
  });

  it("caps the walk at maxDepth", () => {
    let parent: string | undefined;
    let current = "";
    for (let index = 0; index < 5; index++) {
      current = writeSession(`s${index}.jsonl`, {
        type: "session",
        id: `s${index}`,
        cwd: "/work",
        ...(parent === undefined ? {} : { parentSession: parent }),
      });
      parent = current;
    }

    expect(walkSessionChain(current, { maxDepth: 3 })).toHaveLength(3);
    expect(MAX_CHAIN_DEPTH).toBeGreaterThan(3);
  });
});
