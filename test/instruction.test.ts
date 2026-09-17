import { describe, expect, it } from "vitest";
import {
  buildContinueInstruction,
  buildHandoffInjection,
  buildHandoffInstruction,
  REQUIRED_SECTIONS,
} from "../src/handoff/instruction.js";
import type { SessionChainNode } from "../src/handoff/session-chain.js";

const chain: SessionChainNode[] = [
  {
    file: "/sessions/current.jsonl",
    id: "current",
    cwd: "/work",
    parentSession: "/sessions/middle.jsonl",
  },
  {
    file: "/sessions/middle.jsonl",
    id: "middle",
    cwd: "/work",
    parentSession: "/sessions/root.jsonl",
  },
  {
    file: "/sessions/root.jsonl",
    id: "root",
    cwd: "/old",
    parentSession: undefined,
  },
];

describe("buildHandoffInstruction", () => {
  it("demands a body-only reply and lists every required section", () => {
    const instruction = buildHandoffInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain,
      focus: undefined,
    });

    expect(instruction).toContain("Reply with the document body only");
    for (const section of REQUIRED_SECTIONS) {
      expect(instruction).toContain(`\`${section}\``);
    }
  });

  it("tells the agent where the document goes and where to record the session chain", () => {
    const instruction = buildHandoffInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain,
      focus: undefined,
    });

    expect(instruction).toContain("`/sessions/handoffs/h.md`");
    expect(instruction).toContain("current session: `/sessions/current.jsonl`");
    expect(instruction).toContain("/sessions/middle.jsonl");
    expect(instruction).toContain("/sessions/root.jsonl");
  });

  it("notes when there is no earlier session", () => {
    const instruction = buildHandoffInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain: [chain[0] as SessionChainNode],
      focus: undefined,
    });

    expect(instruction).toContain("first session in the chain");
  });

  it("weights the document towards the requested focus", () => {
    const instruction = buildHandoffInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain,
      focus: "the test strategy",
    });

    expect(instruction).toContain("**the test strategy**");
    expect(instruction).not.toContain("did not name a specific focus");
  });

  it("asks for the conversation's language", () => {
    const instruction = buildHandoffInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain,
      focus: undefined,
    });

    expect(instruction).toContain(
      "language this conversation has been conducted in",
    );
  });

  it("demands the full set of operational constraints, including read scopes and privacy", () => {
    const instruction = buildHandoffInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain,
      focus: undefined,
    });

    expect(instruction).toContain("**Constraints & boundaries**");
    expect(instruction).toContain("where the facts in this document came from");
    expect(instruction).toContain("which paths this work may read");
    expect(instruction).toContain("never touch, including privacy directories");
    expect(instruction).toContain("must not be sent to external services");
    expect(instruction).toContain("need explicit user confirmation");
  });
});

describe("buildHandoffInjection", () => {
  it("wraps the stored document in a handoff block and names its path", () => {
    const injection = buildHandoffInjection(
      "---\nhandoff: true\n---\n\nbody",
      "/sessions/handoffs/h.md",
    );

    expect(injection).toContain("`/sessions/handoffs/h.md`");
    expect(injection).toContain(
      "<handoff>\n---\nhandoff: true\n---\n\nbody\n</handoff>",
    );
  });
});

describe("buildContinueInstruction", () => {
  it("starts from the next tasks and refuses to relitigate settled decisions", () => {
    const instruction = buildContinueInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain,
    });

    expect(instruction).toContain(
      'Start with the first item under "Next tasks"',
    );
    expect(instruction).toContain("do not re-ask what it already settles");
    expect(instruction).toContain('Honor "Constraints & boundaries" exactly');
    expect(instruction).toContain("`/sessions/current.jsonl`");
  });

  it("lists earlier sessions for deeper history", () => {
    const instruction = buildContinueInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain,
    });

    expect(instruction).toContain("/sessions/middle.jsonl");
    expect(instruction).toContain("/sessions/root.jsonl");
  });

  it("says so when there is no earlier session", () => {
    const instruction = buildContinueInstruction({
      targetFile: "/sessions/handoffs/h.md",
      sessionFile: "/sessions/current.jsonl",
      chain: [chain[0] as SessionChainNode],
    });

    expect(instruction).toContain("no earlier session to consult");
  });
});
