/**
 * tool.ts — A `handoff` tool the model can call to trigger the same flow as
 * `/handoff`.
 *
 * The tool does not run the handoff itself: it executes mid-turn, where
 * `newSession()` and `waitForIdle()` are not available. Instead it queues
 * `/handoff <focus>` as a follow-up message, which the command handler picks
 * up once the current run settles — the same mechanism the auto-trigger uses.
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface HandoffToolDeps {
  /** Queue `/handoff [focus]` as a follow-up for the command handler. */
  requestHandoff(command: string): void;
  /** Whether the agent is between runs (no streaming in flight). */
  isIdle(): boolean;
}

/** Build the tool definition; registered in `index.ts`. */
export function buildHandoffToolDefinition(deps: HandoffToolDeps) {
  return {
    name: "handoff",
    label: "Handoff",
    description:
      "Hand off the current session to a fresh one. The current agent writes a handoff document (goal, state, decisions, next tasks, session chain, key files), the extension stores it next to the session files, then opens a new session that continues from the document. Call this when the remaining work is better continued with a fresh context — e.g. the context window is nearly full, or the work crosses a major phase boundary and the earlier detail would only add noise.",
    promptSnippet:
      "handoff: Hand off this session to a fresh one; the new session continues from a handoff document.",
    promptGuidelines: [
      "handoff: Call the handoff tool when the context is nearly full or the work is about to cross a major phase boundary — the fresh session continues from the handoff document.",
      "handoff: Before calling handoff, make sure everything the next session needs is either in the repo or about to be written into the handoff document — the current conversation does not carry over.",
    ],
    parameters: Type.Object({
      focus: Type.Optional(
        Type.String({
          description:
            "What the handoff document should emphasize, e.g. 'the migration path and test strategy'.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { focus?: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
    ): Promise<AgentToolResult<undefined>> {
      if (!deps.isIdle()) {
        // A tool call arriving mid-run means the model invoked us during its
        // own turn — the follow-up would queue *after* the current run, which
        // is exactly what we want. But if the agent is somehow still streaming
        // another run, refuse rather than interleave.
        return {
          content: [
            {
              type: "text",
              text: "Cannot hand off while another run is still streaming; wait for it to settle and call handoff again.",
            },
          ],
          details: undefined,
        };
      }

      const focus = params.focus?.trim();
      deps.requestHandoff(
        focus !== undefined && focus.length > 0
          ? `/handoff ${focus}`
          : "/handoff",
      );
      return {
        content: [
          {
            type: "text",
            text: "Handoff queued: once this turn settles, the agent will write the handoff document and a fresh session will continue from it. Wrap up your current reply.",
          },
        ],
        details: undefined,
      };
    },
  };
}
