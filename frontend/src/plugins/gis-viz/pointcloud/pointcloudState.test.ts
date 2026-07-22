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
    expect(state.splatRefreshFps).toBe(30);
  });

  it("allows explicit linear-input encoding for diagnostics", () => {
    usePointCloudStore.getState().setSplatEncodeLinearToSrgb(true);
    expect(usePointCloudStore.getState().splatEncodeLinearToSrgb).toBe(true);
  });

  it("stores and clears structured Gaussian fidelity status", () => {
    const status = {
      outcome: "uploaded" as const,
      sourceCount: 10,
      uploadedCount: 10,
      requestedShDegree: 3,
      effectiveShDegree: 3,
      renderMode: "full" as const,
      resourceMode: "texture-array" as const,
      fallbackReason: null,
    };
    usePointCloudStore.getState().setSplatUploadStatus(status);
    expect(usePointCloudStore.getState().splatUploadStatus).toEqual(status);
    usePointCloudStore.getState().reset();
    expect(usePointCloudStore.getState().splatUploadStatus).toBeNull();
  });
});
