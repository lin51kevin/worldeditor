import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderFrame, STATIC_LAYER_CACHE_MIN_SPLATS, type RendererFrameInternals } from './rendererFrame';

function fakeTexture(width = 800, height = 600) {
  return { width, height, createView: vi.fn(() => ({})), destroy: vi.fn() };
}

function makeRenderer(options: { cache?: boolean; splats?: number } = {}) {
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    setVertexBuffer: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const encoder = {
    beginRenderPass: vi.fn(() => pass),
    copyTextureToTexture: vi.fn(),
    finish: vi.fn(() => ({})),
  };
  const scene = {
    hasContent: true,
    count: options.splats ?? STATIC_LAYER_CACHE_MIN_SPLATS,
    uploading: false,
    orderRevision: 0,
    onCamera: vi.fn(),
    sortGpu: vi.fn(),
    draw: vi.fn(),
    drawDepthOnly: vi.fn(),
  };
  const actors = { hasContent: true, onCamera: vi.fn(), draw: vi.fn() };
  const viewProj = new Float32Array(16).fill(1);
  const r = {
    deviceLost: false,
    disposed: false,
    context: { getCurrentTexture: () => fakeTexture() },
    device: {
      createCommandEncoder: () => encoder,
      createTexture: vi.fn(() => fakeTexture()),
      queue: { submit: vi.fn(), writeBuffer: vi.fn() },
    },
    cameraController: {
      state: { position: [0, 0, 0] },
      isViewDirty: false,
      computeViewProj: () => viewProj,
      dimension: '3d',
      getMetersPerPixel: () => 1,
      currentGridSpacing: 1,
      getGridFadeDistance: () => 100,
    },
    gridUniformData: new Float32Array(26),
    basicUniformData: new Float32Array(32),
    laneRibbonUniformData: new Float32Array(20),
    gridColor: [1, 1, 1],
    msaaTexture: null,
    depthTexture: fakeTexture(),
    clearColor: { r: 0, g: 0, b: 0, a: 0 },
    showGrid: false,
    showAxis: false,
    pointCloudMeshes: [],
    actorPointCloudMeshes: [],
    groundMesh: null,
    egoMesh: null,
    splatRenderer: scene,
    actorSplatRenderer: null,
    actorSplatInstancer: actors,
    meshes: [],
    junctionMeshes: [],
    hoverMeshes: [],
    linkHighlightMeshes: [],
    highlightMeshes: [],
    overlayMeshes: [],
    laneLineMeshes: [],
    laneRibbonMeshes: [],
    pathMeshes: [],
    actorMeshes: [],
    actorOverlayMeshes: [],
    spriteRenderer: null,
    markerRenderer: { curveMeshes: [], markerMeshes: [] },
    overlayRenderers: [],
    overlayCanvas: null,
    width: 800,
    height: 600,
    pixelRatio: 1,
    staticSceneVisible: true,
    sceneSplatsVisible: true,
    format: 'bgra8unorm',
    staticRevision: 0,
    staticLayerCacheEnabled: options.cache ?? true,
    staticLayerCache: null,
    markSceneDirty: vi.fn(),
  };
  return { r: r as unknown as RendererFrameInternals, raw: r, scene, actors, encoder, viewProj };
}

describe('renderFrame static layer cache', () => {
  it('should draw the scene once and then only copy it while nothing static changes', () => {
    const { r, scene, actors, encoder } = makeRenderer();

    renderFrame(r);
    renderFrame(r);
    renderFrame(r);

    expect(scene.draw).toHaveBeenCalledTimes(1);
    expect(scene.drawDepthOnly).toHaveBeenCalledTimes(1);
    expect(actors.draw).toHaveBeenCalledTimes(3);
    expect(encoder.copyTextureToTexture).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['a static change', (f: ReturnType<typeof makeRenderer>) => { f.raw.staticRevision++; }],
    ['a new sort', (f: ReturnType<typeof makeRenderer>) => { f.scene.orderRevision++; }],
    ['a camera move', (f: ReturnType<typeof makeRenderer>) => { f.viewProj[3] = 2; }],
    ['a clear colour change', (f: ReturnType<typeof makeRenderer>) => { f.raw.clearColor = { r: 1, g: 0, b: 0, a: 1 }; }],
  ])('should redraw the scene after %s', (_name, change) => {
    const f = makeRenderer();

    renderFrame(f.r);
    change(f);
    renderFrame(f.r);

    expect(f.scene.draw).toHaveBeenCalledTimes(2);
  });

  it('should draw everything every frame when the cache is off', () => {
    const { r, scene, encoder } = makeRenderer({ cache: false });

    renderFrame(r);
    renderFrame(r);

    expect(scene.draw).toHaveBeenCalledTimes(2);
    expect(encoder.copyTextureToTexture).not.toHaveBeenCalled();
  });

  it('should not cache a scene too small to pay off', () => {
    const { r, scene } = makeRenderer({ splats: STATIC_LAYER_CACHE_MIN_SPLATS - 1 });

    renderFrame(r);
    renderFrame(r);

    expect(scene.draw).toHaveBeenCalledTimes(2);
    expect(r.staticLayerCache).toBeNull();
  });

  it('should not cache while actor point clouds sit inside the static layer', () => {
    const f = makeRenderer();
    f.raw.actorPointCloudMeshes = [{ vertexBuffer: {}, vertexCount: 3 }] as never;
    f.raw.pointCloudPipeline = {} as never;

    renderFrame(f.r);
    renderFrame(f.r);

    expect(f.scene.draw).toHaveBeenCalledTimes(2);
  });

  it('should release the cache once caching stops applying', () => {
    const f = makeRenderer();
    renderFrame(f.r);
    const cache = f.r.staticLayerCache!;

    f.raw.sceneSplatsVisible = false;
    renderFrame(f.r);

    expect(f.r.staticLayerCache).toBeNull();
    expect(cache.color.destroy).toHaveBeenCalled();
    expect(cache.depth.destroy).toHaveBeenCalled();
  });
});

describe('renderFrame GPU backpressure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('should limit unfinished frames and render the latest requested view', async () => {
    const fixture = makeRenderer();
    const completions: Array<() => void> = [];
    const callbacks: FrameRequestCallback[] = [];
    Object.assign(fixture.raw.device.queue, {
      onSubmittedWorkDone: vi.fn(() => new Promise<void>((resolve) => completions.push(resolve))),
    });
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    renderFrame(fixture.r);
    renderFrame(fixture.r);
    fixture.viewProj[0] = 3;
    renderFrame(fixture.r);
    renderFrame(fixture.r);
    expect(fixture.raw.device.queue.submit).toHaveBeenCalledTimes(2);

    fixture.r.cameraController.isViewDirty = false;
    fixture.r.sceneDirty = false;

    completions[0]!();
    await Promise.resolve();
    expect(callbacks).toHaveLength(1);
    callbacks[0]!(0);
    expect(fixture.raw.device.queue.submit).toHaveBeenCalledTimes(3);
    expect(fixture.r.staticLayerCache?.viewProj[0]).toBe(3);
    expect(fixture.r.cameraController.isViewDirty).toBe(true);
  });

  it('should not replay a deferred frame after disposal', async () => {
    const fixture = makeRenderer();
    let complete!: () => void;
    Object.assign(fixture.raw.device.queue, {
      onSubmittedWorkDone: () => new Promise<void>((resolve) => { complete = resolve; }),
    });
    const schedule = vi.spyOn(globalThis, 'requestAnimationFrame');
    renderFrame(fixture.r);
    renderFrame(fixture.r);
    renderFrame(fixture.r);
    fixture.r.disposed = true;
    complete();
    await Promise.resolve();
    expect(fixture.raw.device.queue.submit).toHaveBeenCalledTimes(2);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('should not sort or update the camera of hidden scene splats', () => {
    const fixture = makeRenderer();
    fixture.raw.sceneSplatsVisible = false;
    renderFrame(fixture.r);
    expect(fixture.scene.onCamera).not.toHaveBeenCalled();
    expect(fixture.scene.sortGpu).not.toHaveBeenCalled();
    expect(fixture.actors.draw).toHaveBeenCalled();
  });
});
