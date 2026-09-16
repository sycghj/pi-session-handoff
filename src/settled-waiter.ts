/**
 * settled-waiter.ts — Signal that an agent run has fully settled.
 *
 * `pi.sendUserMessage()` is fire-and-forget: it returns `void`, so a command
 * handler cannot await the run it started. `agent_settled` fires after the run
 * (including retries and compaction continuations) has finished, so the flow
 * arms this waiter before sending the instruction and awaits it afterwards.
 *
 * Both orders are handled: a settle that arrives before `wait()` marks the
 * waiter settled, and the following `wait()` resolves immediately.
 */

export interface SettledWaiter {
  /** Arm the waiter for exactly one upcoming settle. */
  arm(): void;
  /** Resolve once the armed run settles (immediately when it already has). */
  wait(): Promise<void>;
  /** Record a settle; ignored unless the waiter is armed. */
  settle(): void;
}

export function createSettledWaiter(): SettledWaiter {
  let settled = false;
  let resolvePending: (() => void) | undefined;

  const releasePending = (): void => {
    const resolve = resolvePending;
    resolvePending = undefined;
    resolve?.();
  };

  return {
    arm(): void {
      settled = false;
      resolvePending = undefined;
    },

    wait(): Promise<void> {
      if (settled) {
        settled = false;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        resolvePending = resolve;
      });
    },

    settle(): void {
      if (resolvePending !== undefined) {
        releasePending();
        return;
      }
      settled = true;
    },
  };
}
