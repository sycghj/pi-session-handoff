import { describe, expect, it, vi } from "vitest";
import {
  buildHandoffToolDefinition,
  type HandoffToolDeps,
} from "../src/handoff/tool.js";

function createDeps(overrides: Partial<HandoffToolDeps> = {}): HandoffToolDeps {
  return {
    requestHandoff: vi.fn(),
    isIdle: () => true,
    ...overrides,
  };
}

describe("handoff tool", () => {
  it("queues a /handoff follow-up when the model calls it", async () => {
    const deps = createDeps();
    const tool = buildHandoffToolDefinition(deps);

    const result = await tool.execute("call-1", {}, undefined, undefined);

    expect(deps.requestHandoff).toHaveBeenCalledWith(
      expect.stringContaining("/handoff"),
    );
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Handoff queued"),
    });
  });

  it("passes the focus argument through to the command", async () => {
    const deps = createDeps();
    const tool = buildHandoffToolDefinition(deps);

    await tool.execute(
      "call-1",
      { focus: "emphasize the rollback plan" },
      undefined,
      undefined,
    );

    expect(deps.requestHandoff).toHaveBeenCalledWith(
      expect.stringContaining("emphasize the rollback plan"),
    );
  });

  it("refuses while another run is streaming", async () => {
    const deps = createDeps({ isIdle: () => false });
    const tool = buildHandoffToolDefinition(deps);

    const result = await tool.execute("call-1", {}, undefined, undefined);

    expect(deps.requestHandoff).not.toHaveBeenCalled();
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Cannot hand off"),
    });
  });

  it("describes itself for the model", () => {
    const tool = buildHandoffToolDefinition(createDeps());

    expect(tool.name).toBe("handoff");
    expect(tool.description).toMatch(/hand off/i);
    expect(tool.promptSnippet).toContain("handoff");
    expect(tool.promptGuidelines?.join("\n")).toContain("handoff");
  });
});
