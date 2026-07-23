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

describe("pointcloudState setLoaded / setSplatLoaded", () => {
  beforeEach(() => {
    usePointCloudStore.getState().reset();
  });

  it("setLoaded populates cloud metadata", () => {
    const summary = { has_heightmap: true, point_count: 1000, bounds: null };
    usePointCloudStore.getState().setLoaded('handle-1', 'test.pcd', summary as any, false);
    const state = usePointCloudStore.getState();
    expect(state.handle).toBe('handle-1');
    expect(state.fileName).toBe('test.pcd');
    expect(state.stage).toBe('loaded');
    expect(state.hasGround).toBe(true);
    expect(state.isSplat).toBe(false);
    expect(state.error).toBeNull();
  });

  it("setSplatLoaded populates splat buffer metadata", () => {
    const buf = new Uint32Array([1, 2, 3]);
    const summary = { has_heightmap: false, point_count: 500, bounds: null };
    usePointCloudStore.getState().setSplatLoaded('handle-s', 'scene.ply', buf, 3, 2, summary as any, true);
    const state = usePointCloudStore.getState();
    expect(state.handle).toBe('handle-s');
    expect(state.fileName).toBe('scene.ply');
    expect(state.isSplat).toBe(true);
    expect(state.splatBuffer).toBe(buf);
    expect(state.splatShDegree).toBe(3);
    expect(state.splatLayoutVersion).toBe(2);
    expect(state.splatOriginShifted).toBe(true);
    expect(state.nativeBackend).toBe(false);
  });

  it("setGround / setMarkings / setVectorized advance the pipeline stage", () => {
    const summary = { has_heightmap: false, point_count: 100, bounds: null };
    usePointCloudStore.getState().setLoaded('h', 'f.pcd', summary as any, false);

    usePointCloudStore.getState().setGround();
    expect(usePointCloudStore.getState().stage).toBe('ground');
    expect(usePointCloudStore.getState().hasGround).toBe(true);

    usePointCloudStore.getState().setMarkings([{ type: 'line', points: [] }] as any);
    expect(usePointCloudStore.getState().stage).toBe('markings');

    usePointCloudStore.getState().setVectorized();
    expect(usePointCloudStore.getState().stage).toBe('vectorized');
  });

  it("setSplatSampleMode / setSplatRenderMode / setSplatQuality work", () => {
    usePointCloudStore.getState().setSplatSampleMode('nearest' as any);
    expect(usePointCloudStore.getState().splatSampleMode).toBe('nearest');

    usePointCloudStore.getState().setSplatRenderMode('full' as any);
    expect(usePointCloudStore.getState().splatRenderMode).toBe('full');

    usePointCloudStore.getState().setSplatQuality(0.5);
    expect(usePointCloudStore.getState().splatQuality).toBe(0.5);
  });

  it("setSplatQuality clamps to valid range", () => {
    usePointCloudStore.getState().setSplatQuality(2.0);
    expect(usePointCloudStore.getState().splatQuality).toBe(1);

    usePointCloudStore.getState().setSplatQuality(0.01);
    expect(usePointCloudStore.getState().splatQuality).toBe(0.05);
  });

  it("setSplatRefreshFps clamps to non-negative", () => {
    usePointCloudStore.getState().setSplatRefreshFps(-5);
    expect(usePointCloudStore.getState().splatRefreshFps).toBe(0);
  });
});
