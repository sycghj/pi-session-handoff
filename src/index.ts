/**
 * pi-session-handoff — hand the current session off to a fresh one.
 *
 * `/handoff` asks the current agent for a handoff document (goal, state,
 * decisions, next tasks, session chain, key files), stores it next to the
 * session files, then replaces the session and continues automatically from
 * the document. Nothing is compacted, so nothing is lost in translation.
 *
 * Optional arguments narrow what the document should emphasize:
 *   /handoff focus on the test strategy and the migration path
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runHandoff } from "./handoff/flow.js";
import { buildHandoffToolDefinition } from "./handoff/tool.js";
import { createAutoTrigger } from "./handoff/trigger.js";
import { createSettledWaiter } from "./settled-waiter.js";

export default function piSessionHandoff(pi: ExtensionAPI): void {
  // `pi.sendUserMessage()` is fire-and-forget, so the flow needs a settle
  // signal from the event stream to know when the handoff run has finished.
  const waiter = createSettledWaiter();

  const autoTrigger = createAutoTrigger({
    sendUserMessage: (content, options) => {
      pi.sendUserMessage(content, options);
    },
    env: process.env as Record<string, string | undefined>,
  });

  let handoffInFlight = false;

  pi.on("agent_settled", async (event, ctx) => {
    waiter.settle();
    autoTrigger.check(ctx);
  });

  pi.registerCommand("handoff", {
    description:
      "Hand off this session to a fresh one: the agent writes a handoff document, then the new session continues automatically",
    handler: async (args, ctx) => {
      // A tool-initiated handoff and a threshold fire can overlap (the tool
      // queues the command mid-run; the trigger fires at the run's settle),
      // and a manual /handoff can race either. Exactly one may proceed.
      if (handoffInFlight) return;
      handoffInFlight = true;
      try {
        await runHandoff({ ctx, pi, waiter, args });
      } finally {
        handoffInFlight = false;
      }
    },
  });

  pi.registerTool(
    buildHandoffToolDefinition({
      requestHandoff: (command) => {
        // `expandPromptTemplates: true` is required: without it the command
        // text reaches the model as a plain user message and the handler
        // never runs. With it, `prompt()` dispatches the extension command
        // immediately — even mid-run — and `runHandoff` waits for the
        // current run to settle before taking over.
        pi.sendUserMessage(command, {
          deliverAs: "followUp",
          expandPromptTemplates: true,
        });
      },
      isIdle: () => {
        // The tool executes mid-run, so the agent is never idle here; the
        // command handler's own waitForIdle covers the handoff timing.
        return true;
      },
    }),
  );
}
