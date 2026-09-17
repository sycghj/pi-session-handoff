/**
 * instruction.ts — The message that asks the current agent for a handoff.
 *
 * The agent, not this extension, knows what is in flight, so the summary is
 * its job. The extension only fixes the shape of the reply (so a machine can
 * validate it and a fresh agent can act on it) and supplies the facts the
 * agent cannot know reliably: where the document is stored and which sessions
 * precede this one.
 */

import type { SessionChainNode } from "./session-chain.js";

/** Section headings the reply is required to use. */
export const REQUIRED_SECTIONS = [
  "## Goal & background",
  "## Current state",
  "## Decisions & rationale",
  "## Constraints & boundaries",
  "## Next tasks",
  "## Session chain",
  "## Key files & commands",
] as const;

export interface HandoffInstructionOptions {
  /** Where the extension will store the document. */
  targetFile: string;
  /** Session file the handoff is taken from. */
  sessionFile: string;
  /** Ancestor sessions, nearest first. */
  chain: SessionChainNode[];
  /** Extra focus passed to `/handoff`, when any. */
  focus: string | undefined;
}

/** Build the instruction message that asks the agent to write the handoff body. */
export function buildHandoffInstruction(
  options: HandoffInstructionOptions,
): string {
  const sections = REQUIRED_SECTIONS.map((section) => `- \`${section}\``).join(
    "\n",
  );
  const chainLines =
    options.chain.length > 1
      ? options.chain
          .slice(1)
          .map((node, index) => `${index + 1}. ${node.file}`)
          .join("\n")
      : "(none — this is the first session in the chain)";

  const focusParagraph =
    options.focus !== undefined && options.focus.length > 0
      ? `The user asked to focus this handoff on: **${options.focus}**. Weight the document accordingly, without dropping anything the next session still needs.`
      : "The user did not name a specific focus; cover the work as a whole.";

  return `## Handoff requested

This session is about to be replaced. I will open a fresh session and continue the work there automatically, so nothing you write here will be carried over except the document you reply with. Write it for an agent that has none of this conversation.

**Reply with the document body only.** No preamble, no closing remarks, no code fence, no file writes, no tool calls — your reply text is stored verbatim as the document body.

### Required structure

Start with a single title line \`# Handoff: <short title of the work>\`, then these sections, in this order:

${sections}

Cover:

- **Goal & background** — what we are trying to achieve and why, including the issue/PR/plan this work belongs to.
- **Current state** — what is done, what is verified, and what is left half-finished. Be concrete: file paths, commit SHAs, branch names, commands already run and their results.
- **Decisions & rationale** — choices already made and the reason for each, so the next session does not relitigate them.
- **Constraints & boundaries** — every operational constraint that governs this work, so the next session honors it instead of re-deriving it. Include: where the facts in this document came from (data sources, how they were verified); which paths this work may read; which paths it must never touch, including privacy directories and anything off-limits even to listing/scan; write boundaries; anything that must not be sent to external services; commands or operations that are forbidden or need explicit user confirmation; and any other standing rule the next session would otherwise have to guess. Record them even when they seem obvious — the next session cannot re-derive them from the conversation, and guessing is how boundaries get crossed.
- **Next tasks** — an ordered, actionable list: the first thing the next session should do, then the rest. If verification or shipping steps remain, say so explicitly.
- **Session chain** — where earlier history lives. Record these paths:
  - current session: \`${options.sessionFile}\`
${chainLines}
- **Key files & commands** — the files that matter now, and the exact commands for build, test, and run.

### Rules

- Write in the language this conversation has been conducted in.
- Be self-contained and concrete. Prefer exact paths, SHAs, and commands over description.
- Mark anything genuinely unresolved as an open question inside the document rather than asking me now — I cannot answer during this turn.
- Do not restate the handoff process itself; the next session only needs the work.

${focusParagraph}

When your reply ends, I store it at \`${options.targetFile}\` and hand off.`;
}

/** Build the message injected as the first user message of the replacement session. */
export function buildHandoffInjection(
  document: string,
  targetFile: string,
): string {
  return `This session continues from a previous session. The handoff document below was written by that session's agent and stored at \`${targetFile}\`.

<handoff>
${document.trim()}
</handoff>`;
}

export interface ContinueInstructionOptions {
  targetFile: string;
  sessionFile: string;
  chain: SessionChainNode[];
}

/** Build the kickoff message that makes the replacement session start working. */
export function buildContinueInstruction(
  options: ContinueInstructionOptions,
): string {
  const earlier =
    options.chain.length > 1
      ? `Earlier sessions in the chain (nearest first):\n${options.chain
          .slice(1)
          .map((node) => `- ${node.file}`)
          .join("\n")}`
      : "This is the first session in the chain, so there is no earlier session to consult.";

  return `Continue the work from the handoff above.

- Start with the first item under "Next tasks" and work through the list.
- Treat the handoff as authoritative: do not re-ask what it already settles, and do not re-explore what it already establishes.
- Honor "Constraints & boundaries" exactly — read/write scopes, privacy rules, data sources, forbidden operations. They were recorded so you would not have to guess; re-deriving or exceeding them is a boundary violation, not initiative.
- When you need detail the handoff omitted, read the previous session file \`${options.sessionFile}\` (and the handoff document at \`${options.targetFile}\`) rather than guessing.

${earlier}`;
}
