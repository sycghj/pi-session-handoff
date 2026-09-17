import { describe, expect, it, vi } from "vitest";
import {
  createAutoTrigger,
  DEFAULT_AUTO_TRIGGER_PERCENT,
  type TriggerContext,
} from "../src/handoff/trigger.js";

function usageCtx(percent: number | null): TriggerContext {
  return {
    hasUI: false,
    ui: { notify: vi.fn() },
    isIdle: () => true,
    getContextUsage: () =>
      percent === null
        ? { tokens: null, contextWindow: 200_000, percent: null }
        : {
            tokens: (percent / 100) * 200_000,
            contextWindow: 200_000,
            percent,
          },
  };
}

function noUsageCtx(): TriggerContext {
  return {
    hasUI: false,
    ui: { notify: vi.fn() },
    isIdle: () => true,
    getContextUsage: () => undefined,
  };
}

describe("createAutoTrigger — threshold", () => {
  it("fires a follow-up /handoff when usage crosses the default threshold", () => {
    const sent: Array<{ content: string; options?: unknown }> = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content, options) => {
        sent.push({ content, options });
      },
      env: {},
    });

    trigger.check(usageCtx(85));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toContain("/handoff");
    expect(sent[0]?.options).toEqual({
      deliverAs: "followUp",
      expandPromptTemplates: true,
    });
  });

  it("does not fire below the threshold", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: {},
    });

    trigger.check(usageCtx(DEFAULT_AUTO_TRIGGER_PERCENT - 1));

    expect(sent).toEqual([]);
  });

  it("does not fire while the agent is still streaming", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: {},
    });
    const ctx = usageCtx(95);
    ctx.isIdle = () => false;

    trigger.check(ctx);

    expect(sent).toEqual([]);
  });

  it("does not fire when usage is unknown", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: {},
    });

    trigger.check(noUsageCtx());
    trigger.check(usageCtx(null));

    expect(sent).toEqual([]);
  });
});

describe("createAutoTrigger — re-arm", () => {
  it("fires only once per threshold crossing until usage drops back below", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: {},
    });

    trigger.check(usageCtx(85));
    trigger.check(usageCtx(90));
    expect(sent).toHaveLength(1);

    // Usage drops (e.g. new session replaced the old one) → re-armed.
    trigger.check(usageCtx(10));
    trigger.check(usageCtx(85));
    expect(sent).toHaveLength(2);
  });

  it("re-arms when a handoff completes so a failed replacement can retry", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: {},
    });

    trigger.check(usageCtx(85));
    expect(sent).toHaveLength(1);

    // Handoff run settled without replacing the session (validation failed,
    // user aborted, …): usage is still above the threshold, but the trigger
    // must not spam a follow-up on every settle. It stays disarmed until the
    // user explicitly re-arms or usage drops.
    trigger.check(usageCtx(85));
    expect(sent).toHaveLength(1);
  });
});

describe("createAutoTrigger — configuration", () => {
  it("honours a threshold from the environment", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: { PI_HANDOFF_AUTO_PERCENT: "90" },
    });

    trigger.check(usageCtx(85));
    expect(sent).toEqual([]);

    trigger.check(usageCtx(92));
    expect(sent).toHaveLength(1);
  });

  it("is disabled when the environment sets the threshold to off", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: { PI_HANDOFF_AUTO_PERCENT: "off" },
    });

    trigger.check(usageCtx(99));

    expect(sent).toEqual([]);
  });

  it("ignores an unparseable threshold and uses the default", () => {
    const sent: string[] = [];
    const trigger = createAutoTrigger({
      sendUserMessage: (content) => {
        sent.push(content);
      },
      env: { PI_HANDOFF_AUTO_PERCENT: "banana" },
    });

    trigger.check(usageCtx(85));
    expect(sent).toHaveLength(1);
  });
});

describe("createAutoTrigger — notification", () => {
  it("notifies the user with the current percentage when it fires", () => {
    const notify = vi.fn();
    const trigger = createAutoTrigger({
      sendUserMessage: () => {},
      env: {},
    });
    const ctx: TriggerContext = {
      ...usageCtx(83),
      hasUI: true,
      ui: { notify },
    };

    trigger.check(ctx);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("83"), "info");
  });
});
