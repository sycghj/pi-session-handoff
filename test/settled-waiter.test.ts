import { describe, expect, it } from "vitest";
import { createSettledWaiter } from "../src/settled-waiter.js";

describe("createSettledWaiter", () => {
  it("resolves a wait that is already pending", async () => {
    const waiter = createSettledWaiter();
    waiter.arm();

    const waited = waiter.wait();
    waiter.settle();

    await expect(waited).resolves.toBeUndefined();
  });

  it("resolves immediately for a settle that arrived before the wait", async () => {
    const waiter = createSettledWaiter();
    waiter.arm();
    waiter.settle();

    await expect(waiter.wait()).resolves.toBeUndefined();
  });

  it("starts the next run clean after a settle was consumed", async () => {
    const waiter = createSettledWaiter();
    waiter.arm();
    waiter.settle();
    await waiter.wait();

    waiter.arm();
    let resolved = false;
    const waited = waiter.wait().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    waiter.settle();
    await waited;
    expect(resolved).toBe(true);
  });

  it("ignores a settle that arrives while not armed", async () => {
    const waiter = createSettledWaiter();
    waiter.settle();

    waiter.arm();
    let resolved = false;
    const waited = waiter.wait().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    waiter.settle();
    await waited;
  });

  it("does not carry a settle across an arm", async () => {
    const waiter = createSettledWaiter();
    waiter.arm();
    waiter.settle();
    waiter.arm();

    let resolved = false;
    const waited = waiter.wait().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    waiter.settle();
    await waited;
  });
});
