/**
 * notify.ts — UI notifications that are safe to skip.
 *
 * Extensions run in modes without a UI (`print`, `json`), where `ctx.hasUI` is
 * false. Notifications are best-effort: they never fail a handoff.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type NotifyLevel = "info" | "warning" | "error";

/** Minimal UI surface needed to notify; satisfied by any extension context. */
export interface Notifier {
  readonly hasUI: boolean;
  readonly ui: { notify(message: string, type?: NotifyLevel): void };
}

/** Show a notification when the current mode has a UI, ignoring UI failures. */
export function notify(
  target: Notifier,
  message: string,
  level: NotifyLevel = "info",
): void {
  if (!target.hasUI) return;
  try {
    target.ui.notify(message, level);
  } catch {
    // A UI that cannot render a notification must not fail the handoff.
  }
}

/** `ctx` used as a notifier (its UI surface is a structural superset). */
export function notifierFrom(ctx: ExtensionContext): Notifier {
  return ctx;
}
