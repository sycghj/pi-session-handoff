/**
 * trigger.ts — Fire `/handoff` automatically when the context fills up.
 *
 * Pi's own auto-compaction kicks in at `tokens > contextWindow − 16384`
 * (~92% on a 200k window). A handoff turn needs headroom to write the
 * document, so this trigger fires earlier — at `percent ≥ threshold` — and
 * queues `/handoff` as a follow-up. The handoff replaces the session before
 * compaction is ever reached, so the two mechanisms never fight.
 *
 * The trigger fires once per threshold crossing: after firing it stays
 * disarmed until observed usage drops back below the threshold (which a
 * session replacement guarantees, since the fresh session starts near zero).
 * A failed handoff must not spam a new follow-up on every subsequent settle.
 *
 * Configuration: `PI_HANDOFF_AUTO_PERCENT` (integer 1–100, or "off").
 */

import { type Notifier, notify } from "../notify.js";

export const DEFAULT_AUTO_TRIGGER_PERCENT = 80;

export const AUTO_TRIGGER_ENV = "PI_HANDOFF_AUTO_PERCENT";

/** Context surface the trigger reads. */
export interface TriggerContext extends Notifier {
  isIdle(): boolean;
  getContextUsage():
    | { tokens: number | null; contextWindow: number; percent: number | null }
    | undefined;
}

/** Minimal sender surface; matches the signature of `pi.sendUserMessage`. */
export interface TriggerSender {
  sendUserMessage(
    content: string,
    options?: { deliverAs?: "steer" | "followUp" },
  ): void;
}

export interface AutoTriggerDeps {
  sendUserMessage: TriggerSender["sendUserMessage"];
  /** Environment source, injectable for tests. */
  env: Record<string, string | undefined>;
}

export interface AutoTrigger {
  /** Check usage after a settle; fires at most once per crossing. */
  check(ctx: TriggerContext): void;
}

export function createAutoTrigger(deps: AutoTriggerDeps): AutoTrigger {
  const threshold = parseThreshold(deps.env[AUTO_TRIGGER_ENV]);
  let armed = threshold !== undefined;

  return {
    check(ctx) {
      if (threshold === undefined) return;
      if (!ctx.isIdle()) return;
      const usage = ctx.getContextUsage();
      const percent = usage?.percent;
      if (percent === undefined || percent === null) return;

      if (percent < threshold) {
        armed = true;
        return;
      }
      if (!armed) return;
      armed = false;

      notify(ctx, `上下文已达 ${Math.round(percent)}%，自动交接中…`, "info");
      deps.sendUserMessage("/handoff 自动交接（上下文接近上限）", {
        deliverAs: "followUp",
      });
    },
  };
}

function parseThreshold(raw: string | undefined): number | undefined {
  if (raw === undefined) return DEFAULT_AUTO_TRIGGER_PERCENT;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "off" || trimmed === "0") return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 100) {
    return DEFAULT_AUTO_TRIGGER_PERCENT;
  }
  return parsed;
}
