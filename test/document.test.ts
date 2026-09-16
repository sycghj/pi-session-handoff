import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  findLastAssistantReply,
  type HandoffMetadata,
  MIN_HANDOFF_BODY_LENGTH,
  normalizeHandoffBody,
  renderFrontmatter,
  renderHandoffDocument,
  validateHandoffBody,
} from "../src/handoff/document.js";
import {
  formatFileTimestamp,
  resolveHandoffTarget,
} from "../src/handoff/target.js";

const metadata: HandoffMetadata = {
  createdAt: "2026-09-16T13:42:16.000Z",
  fromSession:
    "/home/u/.pi/agent/sessions/--work--/2026-09-16T13-00-00-000Z_abc.jsonl",
  fromSessionId: "abc",
  cwd: "/work/project",
  parentSessions: ["/home/u/.pi/agent/sessions/--work--/parent.jsonl"],
  focus: undefined,
};

function assistantEntry(text: string, stopReason = "stop", id = "a1") {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-09-16T13:00:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason,
    },
  } as unknown as SessionEntry;
}

describe("resolveHandoffTarget", () => {
  it("places the document in a handoffs subdirectory of the session directory", () => {
    const sessionDir = "/home/u/.pi/agent/sessions/--work--";
    const target = resolveHandoffTarget({
      sessionDir,
      sessionId: "abc",
      now: new Date("2026-09-16T13:42:16.789Z"),
    });

    expect(target.dir).toBe(join(sessionDir, "handoffs"));
    expect(target.file).toBe(
      join(sessionDir, "handoffs", "2026-09-16T13-42-16-789Z_abc.md"),
    );
  });

  it("formats timestamps without characters that are illegal in file names", () => {
    expect(formatFileTimestamp(new Date("2026-01-02T03:04:05.006Z"))).toBe(
      "2026-01-02T03-04-05-006Z",
    );
  });
});

describe("renderFrontmatter", () => {
  it("records the source session, cwd, and the parent chain", () => {
    const frontmatter = renderFrontmatter(metadata);

    expect(frontmatter.startsWith("---\n")).toBe(true);
    expect(frontmatter.endsWith("\n---")).toBe(true);
    expect(frontmatter).toContain("handoff: true");
    expect(frontmatter).toContain(
      `from_session: ${JSON.stringify(metadata.fromSession)}`,
    );
    expect(frontmatter).toContain(`cwd: ${JSON.stringify(metadata.cwd)}`);
    expect(frontmatter).toContain("parent_sessions:\n  - ");
  });

  it("renders an empty parent chain as an empty list", () => {
    expect(renderFrontmatter({ ...metadata, parentSessions: [] })).toContain(
      "parent_sessions: []",
    );
  });

  it("includes focus only when the user asked for one", () => {
    expect(renderFrontmatter(metadata)).not.toContain("focus:");
    expect(
      renderFrontmatter({ ...metadata, focus: 'tests "and" more' }),
    ).toContain(`focus: ${JSON.stringify('tests "and" more')}`);
  });

  it("escapes backslashes in Windows paths so the YAML stays parseable", () => {
    const frontmatter = renderFrontmatter({
      ...metadata,
      fromSession: "C:\\Users\\u\\.pi\\sessions\\a.jsonl",
    });

    expect(frontmatter).toContain(
      'from_session: "C:\\\\Users\\\\u\\\\.pi\\\\sessions\\\\a.jsonl"',
    );
  });
});

describe("renderHandoffDocument", () => {
  it("puts frontmatter above the agent body", () => {
    const document = renderHandoffDocument(
      metadata,
      "# Handoff: thing\n\nbody",
    );

    expect(document.indexOf("handoff: true")).toBeLessThan(
      document.indexOf("# Handoff: thing"),
    );
    expect(document.endsWith("# Handoff: thing\n\nbody\n")).toBe(true);
  });
});

describe("validateHandoffBody", () => {
  it("accepts a body with a heading and enough text", () => {
    const body = `# Handoff: work\n\n${"detail ".repeat(MIN_HANDOFF_BODY_LENGTH / 7)}`;

    expect(validateHandoffBody(body)).toEqual({ ok: true });
  });

  it("rejects a short body", () => {
    const result = validateHandoffBody("# Handoff: x\n\nshort");

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("过短");
  });

  it("rejects a body with no heading", () => {
    const result = validateHandoffBody(
      "all prose, no structure at all ".repeat(20),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("标题");
  });
});

describe("normalizeHandoffBody", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeHandoffBody("\n\n# Handoff: x\n\n")).toBe("# Handoff: x");
  });

  it("unwraps a reply that is one fenced block", () => {
    expect(normalizeHandoffBody("```markdown\n# Handoff: x\n\nbody\n```")).toBe(
      "# Handoff: x\n\nbody",
    );
  });

  it("keeps inner fences of a document that is not wholly fenced", () => {
    const body = "# Handoff: x\n\ntext\n\n```bash\nnpm test\n```\n\nmore";

    expect(normalizeHandoffBody(body)).toBe(body);
  });
});

describe("findLastAssistantReply", () => {
  it("returns the newest assistant text", () => {
    const branch = [
      assistantEntry("first", "stop", "a1"),
      assistantEntry("second", "stop", "a2"),
    ];

    expect(findLastAssistantReply(branch)).toEqual({
      text: "second",
      stopReason: "stop",
    });
  });

  it("falls back to the last assistant text when the newest assistant message has none", () => {
    const branch = [
      assistantEntry("real summary", "stop", "a1"),
      { ...assistantEntry("", "toolUse", "a2") } as SessionEntry,
    ];

    expect(findLastAssistantReply(branch)).toEqual({
      text: "real summary",
      stopReason: "toolUse",
    });
  });

  it("reports an aborted run", () => {
    const reply = findLastAssistantReply([
      assistantEntry("partial", "aborted"),
    ]);

    expect(reply?.stopReason).toBe("aborted");
  });

  it("ignores user messages", () => {
    const userEntry = {
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "2026-09-16T13:00:00.000Z",
      message: { role: "user", content: "hello", timestamp: 1 },
    } as unknown as SessionEntry;

    expect(findLastAssistantReply([userEntry])).toBeUndefined();
    expect(findLastAssistantReply([])).toBeUndefined();
  });
});
