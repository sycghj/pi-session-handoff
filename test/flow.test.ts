import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type HandoffContext,
  type NewSessionRequest,
  type ReplacementContext,
  runHandoff,
} from "../src/handoff/flow.js";
import { createSettledWaiter } from "../src/settled-waiter.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "handoff-flow-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const GOOD_BODY = `# Handoff: implement the handoff plugin

## Goal & background
Ship the /handoff command so a session can be replaced without losing context.

## Next tasks
1. Run the end-to-end check against a scratch project.

${"Extra detail that makes the body long enough to validate. ".repeat(4).trim()}`;

function assistantEntry(text: string, stopReason = "stop"): SessionEntry {
  return {
    type: "message",
    id: "a1",
    parentId: null,
    timestamp: "2026-09-16T13:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason,
    },
  } as unknown as SessionEntry;
}

function writeSession(name: string, header: Record<string, unknown>): string {
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(header)}\n`);
  return file;
}

/** A persisted session file, so the flow gets past its first guard. */
function currentSession(): string {
  return writeSession("current.jsonl", {
    type: "session",
    id: "current",
    cwd: "/work",
  });
}

interface FakeOptions {
  sessionFile?: string | undefined;
  sessionDir?: string;
  sessionId?: string;
  cwd?: string;
  /** Entries already in the session before the handoff run. */
  branchBefore?: SessionEntry[];
  /** Entries the handoff run appends — i.e. the agent's reply. */
  branch?: SessionEntry[];
  idle?: boolean;
  hasUI?: boolean;
  newSessionCancelled?: boolean;
  kickoffFails?: boolean;
}

/**
 * Fake command context plus a fake `pi` whose `sendUserMessage` behaves like a
 * real run: it appends the run's entries to the branch before signalling settle.
 */
function createHarness(options: FakeOptions = {}) {
  const notifications: Array<{ message: string; level: string }> = [];
  const appended: string[] = [];
  const kickoffs: string[] = [];
  const requests: NewSessionRequest[] = [];
  const sent: string[] = [];
  const writes: Array<{ file: string; content: string }> = [];
  const dirs: string[] = [];
  const replyEntries = options.branch ?? [];
  let waitForIdleCalls = 0;
  let branch = options.branchBefore ?? [];

  const waiter = createSettledWaiter();

  const notify = (message: string, level = "info") => {
    notifications.push({ message, level });
  };

  const ctx = {
    hasUI: options.hasUI ?? true,
    ui: { notify },
    cwd: options.cwd ?? "/work/project",
    isIdle: () => options.idle ?? true,
    waitForIdle: async () => {
      waitForIdleCalls += 1;
    },
    sessionManager: {
      getSessionFile: () => options.sessionFile,
      getSessionDir: () => options.sessionDir ?? join(dir, "sessions"),
      getSessionId: () => options.sessionId ?? "sid-1",
      getBranch: () => branch,
    },
    newSession: async (request: NewSessionRequest = {}) => {
      requests.push(request);
      if (options.newSessionCancelled === true) return { cancelled: true };

      const sessionManager = {
        appendMessage: (message: { content: unknown }) => {
          appended.push(textOf(message.content));
          return "entry-1";
        },
      } as unknown as SessionManager;
      await request.setup?.(sessionManager);

      const replacement = {
        hasUI: options.hasUI ?? true,
        ui: { notify },
        sendUserMessage: async (content: string) => {
          if (options.kickoffFails === true) {
            throw new Error("model unavailable");
          }
          kickoffs.push(content);
        },
      } as unknown as ReplacementContext;
      await request.withSession?.(replacement);

      return { cancelled: false };
    },
  } as unknown as HandoffContext;

  const pi = {
    sendUserMessage: (content: string) => {
      sent.push(content);
      branch = [...branch, ...replyEntries];
      waiter.settle();
    },
  };

  return {
    ctx,
    pi,
    waiter,
    sent,
    writes,
    dirs,
    notifications,
    appended,
    kickoffs,
    requests,
    waitForIdleCalls: () => waitForIdleCalls,
    run: (
      args = "",
      deps?: {
        writeDocument?: (file: string, content: string) => void;
        ensureDir?: (target: string) => void;
      },
    ) =>
      runHandoff({
        ctx,
        pi,
        waiter,
        args,
        deps: {
          now: () => new Date("2026-09-16T13:42:16.000Z"),
          writeDocument:
            deps?.writeDocument ??
            ((file, content) => {
              writes.push({ file, content });
            }),
          ensureDir:
            deps?.ensureDir ??
            ((target) => {
              dirs.push(target);
            }),
        },
      }),
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && "text" in part
          ? String(part.text)
          : "",
      )
      .join("\n");
  }
  return String(content);
}

describe("runHandoff — success path", () => {
  it("stores the document, replaces the session, and continues automatically", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [assistantEntry(GOOD_BODY)],
    });

    const outcome = await harness.run("focus on tests");

    expect(outcome.status).toBe("completed");
    expect(harness.writes[0]?.file).toContain(
      join("handoffs", "2026-09-16T13-42-16-000Z_sid-1.md"),
    );
    expect(harness.dirs).toEqual([join(dir, "sessions", "handoffs")]);
  });

  it("writes frontmatter naming the source session and its full chain", async () => {
    const root = writeSession("root.jsonl", {
      type: "session",
      id: "root",
      cwd: "/work",
    });
    const current = writeSession("current.jsonl", {
      type: "session",
      id: "current",
      cwd: "/work",
      parentSession: root,
    });
    const harness = createHarness({
      sessionFile: current,
      branch: [assistantEntry(GOOD_BODY)],
    });

    await harness.run();

    const content = harness.writes[0]?.content ?? "";
    expect(content).toContain("handoff: true");
    expect(content).toContain(`from_session: ${JSON.stringify(current)}`);
    expect(content).toContain(`cwd: ${JSON.stringify("/work/project")}`);
    expect(content).toContain(`  - ${JSON.stringify(root)}`);
    expect(content).toContain(GOOD_BODY);
  });

  it("asks the current agent for the body without asking it to touch a file", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [assistantEntry(GOOD_BODY)],
    });

    await harness.run("emphasize the migration");

    const instruction = harness.sent[0] ?? "";
    expect(instruction).toContain("Reply with the document body only");
    expect(instruction).toContain("no file writes, no tool calls");
    expect(instruction).toContain("**emphasize the migration**");
    expect(instruction).toContain(harness.writes[0]?.file ?? "missing");
  });

  it("records the parent session and injects the document plus the kickoff", async () => {
    const current = currentSession();
    const harness = createHarness({
      sessionFile: current,
      branch: [assistantEntry(GOOD_BODY)],
    });

    await harness.run();

    expect(harness.requests[0]?.parentSession).toBe(current);
    expect(harness.appended[0]).toContain("<handoff>");
    expect(harness.appended[0]).toContain(GOOD_BODY);
    expect(harness.kickoffs[0]).toContain(
      'Start with the first item under "Next tasks"',
    );
    expect(harness.kickoffs[0]).toContain(current);
  });

  it("waits for an in-flight turn before asking for the handoff", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      idle: false,
      branch: [assistantEntry(GOOD_BODY)],
    });

    await harness.run();

    expect(harness.waitForIdleCalls()).toBe(1);
    expect(harness.sent).toHaveLength(1);
  });
});

describe("runHandoff — refusal paths", () => {
  it("fails without a persisted session file", async () => {
    const harness = createHarness({
      sessionFile: undefined,
      branch: [assistantEntry(GOOD_BODY)],
    });

    const outcome = await harness.run();

    expect(outcome).toEqual({
      status: "failed",
      reason: expect.stringContaining("未持久化"),
    });
    expect(harness.sent).toEqual([]);
    expect(harness.requests).toEqual([]);
  });

  it("cancels when the handoff turn was aborted", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [assistantEntry("partial", "aborted")],
    });

    const outcome = await harness.run();

    expect(outcome.status).toBe("cancelled");
    expect(harness.writes).toEqual([]);
    expect(harness.requests).toEqual([]);
  });

  it("fails when the agent produced no text", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [],
    });

    const outcome = await harness.run();

    expect(outcome).toEqual({
      status: "failed",
      reason: expect.stringContaining("没有输出交接文档"),
    });
    expect(harness.requests).toEqual([]);
  });

  it("does not reuse an earlier assistant reply when the handoff produced no text", async () => {
    const stale = assistantEntry(
      `# Handoff: unrelated earlier work\n\n${"Old summary text long enough to pass validation. ".repeat(6).trim()}`,
    );
    const harness = createHarness({
      sessionFile: currentSession(),
      branchBefore: [stale],
      // The handoff run ends on a tool-only assistant message: no body.
      branch: [assistantEntry("", "toolUse")],
    });

    const outcome = await harness.run();

    expect(harness.sent).toHaveLength(1);
    expect(outcome).toEqual({
      status: "failed",
      reason: expect.stringContaining("没有输出交接文档"),
    });
    expect(harness.writes).toEqual([]);
    expect(harness.requests).toEqual([]);
  });

  it("fails when the body is too short to be a handoff", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [assistantEntry("# Handoff: x\n\nnope")],
    });

    const outcome = await harness.run();

    expect(outcome).toEqual({
      status: "failed",
      reason: expect.stringContaining("过短"),
    });
    expect(harness.writes).toEqual([]);
    expect(harness.requests).toEqual([]);
  });

  it("fails when the document cannot be written", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [assistantEntry(GOOD_BODY)],
    });

    const outcome = await harness.run("", {
      ensureDir: () => {
        throw new Error("EACCES");
      },
      writeDocument: () => {},
    });

    expect(outcome).toEqual({
      status: "failed",
      reason: expect.stringContaining("EACCES"),
    });
    expect(harness.requests).toEqual([]);
  });

  it("reports a cancelled replacement while keeping the document", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [assistantEntry(GOOD_BODY)],
      newSessionCancelled: true,
    });

    const outcome = await harness.run();

    expect(outcome.status).toBe("cancelled");
    expect(harness.writes).toHaveLength(1);
    expect(
      harness.notifications.some((entry) => entry.level === "warning"),
    ).toBe(true);
  });

  it("still completes when the kickoff turn cannot start", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      branch: [assistantEntry(GOOD_BODY)],
      kickoffFails: true,
    });

    const outcome = await harness.run();

    expect(outcome.status).toBe("completed");
    expect(harness.notifications.some((entry) => entry.level === "error")).toBe(
      true,
    );
  });

  it("stays silent when the mode has no UI", async () => {
    const harness = createHarness({
      sessionFile: currentSession(),
      hasUI: false,
      branch: [assistantEntry("# Handoff: x\n\nnope")],
    });

    const outcome = await harness.run();

    expect(outcome.status).toBe("failed");
    expect(harness.notifications).toEqual([]);
  });
});
