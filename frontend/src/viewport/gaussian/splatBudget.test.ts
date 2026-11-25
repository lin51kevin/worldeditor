import { describe, expect, it } from "vitest";
import { HELD_TAU_MIN, nextHeldThinTau, nextThinTau, THIN_TAU_INITIAL, THIN_TAU_MAX } from "./splatBudget";

describe("nextThinTau", () => {
  it("stays off when no budget is set", () => {
    expect(nextThinTau(5, 50_000_000, 0)).toBe(0);
  });

  it("starts thinning at the initial threshold when the visible count exceeds the budget", () => {
    expect(nextThinTau(0, 8_000_000, 4_000_000)).toBeGreaterThanOrEqual(THIN_TAU_INITIAL);
  });

  it("raises the threshold in proportion to the overshoot, but never above the cap", () => {
    const mild = nextThinTau(4, 5_000_000, 4_000_000);
    const heavy = nextThinTau(4, 40_000_000, 4_000_000);
    expect(mild).toBeGreaterThan(4);
    expect(heavy).toBeGreaterThan(mild);
    expect(nextThinTau(THIN_TAU_MAX, 400_000_000, 4_000_000)).toBe(THIN_TAU_MAX);
  });

  it("holds the threshold while the count is near the budget", () => {
    expect(nextThinTau(6, 3_900_000, 4_000_000)).toBe(6);
  });

  it("relaxes the threshold when well under budget and switches off once it is tiny", () => {
    const relaxed = nextThinTau(6, 1_000_000, 4_000_000);
    expect(relaxed).toBeLessThan(6);
    expect(relaxed).toBeGreaterThan(0);
    let tau = 6;
    for (let i = 0; i < 20; i++) tau = nextThinTau(tau, 1_000, 4_000_000);
    expect(tau).toBe(0);
  });

  it("does not turn thinning on while under budget", () => {
    expect(nextThinTau(0, 1_000_000, 4_000_000)).toBe(0);
  });
});

describe("nextHeldThinTau", () => {
  it("never leaves thinning off, even when far under budget", () => {
    let tau = 2;
    for (let i = 0; i < 40; i++) tau = nextHeldThinTau(tau, 1_000, 4_000_000);
    expect(tau).toBe(HELD_TAU_MIN);
  });

  it("closes a large undershoot in a few steps, using kept count ~ 1/tau^2", () => {
    const kept = (tau: number): number => 12_000_000 * Math.min(1, (0.05 / tau) ** 2);
    let tau = 2;
    for (let i = 0; i < 4; i++) tau = nextHeldThinTau(tau, kept(tau), 1_500_000);
    expect(kept(tau)).toBeGreaterThan(1_500_000 * 0.7);
    expect(kept(tau)).toBeLessThan(1_500_000 * 1.05 * 1.5);
  });

  it("raises the threshold when over budget, but never above the cap", () => {
    expect(nextHeldThinTau(1, 16_000_000, 4_000_000)).toBeGreaterThan(1);
    expect(nextHeldThinTau(THIN_TAU_MAX, 400_000_000, 4_000_000)).toBe(THIN_TAU_MAX);
  });

  it("keeps the threshold near the budget and stays off without one", () => {
    expect(nextHeldThinTau(3, 3_900_000, 4_000_000)).toBe(3);
    expect(nextHeldThinTau(3, 9_000_000, 0)).toBe(0);
  });
});
