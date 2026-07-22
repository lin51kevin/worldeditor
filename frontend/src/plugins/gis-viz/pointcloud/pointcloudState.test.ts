import { beforeEach, describe, expect, it } from "vitest";
import { usePointCloudStore } from "./pointcloudState";

describe("pointcloudState Gaussian defaults", () => {
  beforeEach(() => {
    usePointCloudStore.getState().reset();
  });

  it("uses the reference low-pass and direct gamma-space SH output", () => {
    const state = usePointCloudStore.getState();
    expect(state.splatDilation).toBe(0.3);
    expect(state.splatEncodeLinearToSrgb).toBe(false);
  });

  it("allows explicit linear-input encoding for diagnostics", () => {
    usePointCloudStore.getState().setSplatEncodeLinearToSrgb(true);
    expect(usePointCloudStore.getState().splatEncodeLinearToSrgb).toBe(true);
  });
});
