/**
 * flow.ts — Orchestrate one handoff.
 *
 * Sequence:
 *   1. resolve the handoff target and walk the session chain
 *   2. ask the current agent for the handoff body and wait for the run to settle
 *   3. validate the reply and store the document (frontmatter written by us)
 *   4. replace the session, injecting the document and a kickoff instruction
 *
 * Steps 1–3 run against the current session's context. Step 4 invalidates it,
 * so every UI action after the replacement goes through the replacement
 * context — using the old one throws.
 */

import { writeFileSync } from "node:fs";
import type {
  SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type Notifier, notify } from "../notify.js";
import type { SettledWaiter } from "../settled-waiter.js";
import {
  findLastAssistantReply,
  type HandoffMetadata,
  normalizeHandoffBody,
  renderHandoffDocument,
  validateHandoffBody,
} from "./document.js";
import {
  buildContinueInstruction,
  buildHandoffInjection,
  buildHandoffInstruction,
} from "./instruction.js";
import { walkSessionChain } from "./session-chain.js";
import { ensureHandoffDir, resolveHandoffTarget } from "./target.js";

/** Result of a handoff attempt. */
export type HandoffOutcome =
  | { status: "completed"; file: string }
  | { status: "cancelled"; reason: string }
  | { status: "failed"; reason: string };

/** Session state a handoff reads from the current context. */
export interface HandoffSessionManager {
  getSessionFile(): string | undefined;
  getSessionDir(): string;
  getSessionId(): string;
  getBranch(): readonly SessionEntry[];
}

/**
 * The replacement-session surface a handoff needs. The SDK's own
 * `ReplacedSessionContext` type is not part of its public exports, so this
 * port states the requirement instead of importing it.
 */
export interface ReplacementContext extends Notifier {
  sendUserMessage(content: string): Promise<void>;
}

export interface NewSessionRequest {
  parentSession?: string;
  setup?: (sessionManager: SessionManager) => Promise<void>;
  withSession?: (ctx: ReplacementContext) => Promise<void>;
}

/** The command-context surface a handoff needs. */
export interface HandoffContext extends Notifier {
  /** Working directory of the session, recorded in the document frontmatter. */
  cwd: string;
  isIdle(): boolean;
  waitForIdle(): Promise<void>;
  sessionManager: HandoffSessionManager;
  newSession(options?: NewSessionRequest): Promise<{ cancelled: boolean }>;
}

/** The extension-API surface a handoff needs. */
export interface HandoffPromptSender {
  sendUserMessage(content: string): void;
}

export interface HandoffDependencies {
  /** Clock, injectable for deterministic tests. */
  now?: () => Date;
  /** Document writer, injectable for tests. */
  writeDocument?: (file: string, content: string) => void;
  /** Directory creator, injectable for tests. */
  ensureDir?: (dir: string) => void;
}

export interface HandoffRequest {
  ctx: HandoffContext;
  pi: HandoffPromptSender;
  waiter: SettledWaiter;
  /** Raw command arguments; extra focus for the document. */
  args: string;
  deps?: HandoffDependencies;
}

/** Run one handoff from `/handoff`. */
export async function runHandoff(
  request: HandoffRequest,
): Promise<HandoffOutcome> {
  const { ctx, pi, waiter } = request;
  const deps = request.deps ?? {};
  const focus = request.args.trim();

  const sessionFile = ctx.sessionManager.getSessionFile();
  if (sessionFile === undefined) {
    return fail(ctx, "当前会话没有会话文件（未持久化），无法生成交接文档");
  }

  if (!ctx.isIdle()) {
    notify(ctx, "等待当前回合结束后再交接…", "info");
    await ctx.waitForIdle();
  }

  const now = deps.now?.() ?? new Date();
  const target = resolveHandoffTarget({
    sessionDir: ctx.sessionManager.getSessionDir(),
    sessionId: ctx.sessionManager.getSessionId(),
    now,
  });
  const chain = walkSessionChain(sessionFile);

  waiter.arm();
  pi.sendUserMessage(
    buildHandoffInstruction({
      targetFile: target.file,
      sessionFile,
      chain,
      focus: focus.length > 0 ? focus : undefined,
    }),
  );
  await waiter.wait();

  const reply = findLastAssistantReply(ctx.sessionManager.getBranch());
  if (reply?.stopReason === "aborted") {
    notify(ctx, "交接已取消（回合被中断）", "warning");
    return { status: "cancelled", reason: "回合被中断" };
  }
  if (reply?.text === undefined) {
    return fail(ctx, "Agent 没有输出交接文档，仍在原会话");
  }

  const body = normalizeHandoffBody(reply.text);
  const validation = validateHandoffBody(body);
  if (!validation.ok) {
    return fail(
      ctx,
      `交接文档不可用：${validation.reason ?? "格式不符"}，仍在原会话`,
    );
  }

  const metadata: HandoffMetadata = {
    createdAt: now.toISOString(),
    fromSession: sessionFile,
    fromSessionId: ctx.sessionManager.getSessionId(),
    cwd: ctx.cwd,
    parentSessions: chain.slice(1).map((node) => node.file),
    focus: focus.length > 0 ? focus : undefined,
  };

  try {
    (deps.ensureDir ?? ensureHandoffDir)(target.dir);
    (deps.writeDocument ?? writeFileSync)(
      target.file,
      renderHandoffDocument(metadata, body),
    );
  } catch (error) {
    return fail(ctx, `写入交接文件失败：${errorMessage(error)}`);
  }

  notify(ctx, `交接文件已写入 ${target.file}，正在开启新会话…`, "info");

  const document = renderHandoffDocument(metadata, body);
  const result = await ctx.newSession({
    parentSession: sessionFile,
    setup: async (sessionManager) => {
      sessionManager.appendMessage({
        role: "user",
        content: [
          { type: "text", text: buildHandoffInjection(document, target.file) },
        ],
        timestamp: Date.now(),
      });
    },
    withSession: async (replacement) => {
      try {
        await replacement.sendUserMessage(
          buildContinueInstruction({
            targetFile: target.file,
            sessionFile,
            chain,
          }),
        );
      } catch (error) {
        notify(
          replacement,
          `新会话已建立，但自动继续失败：${errorMessage(error)}`,
          "error",
        );
      }
    },
  });

  if (result.cancelled) {
    notify(ctx, `新会话被取消，交接文件保留在 ${target.file}`, "warning");
    return { status: "cancelled", reason: "新会话被取消" };
  }

  return { status: "completed", file: target.file };
}

function fail(ctx: Notifier, reason: string): HandoffOutcome {
  notify(ctx, reason, "error");
  return { status: "failed", reason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
