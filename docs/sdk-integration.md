# rnk-next SDK Integration Guide

worldeditor-next can be built as a self-contained **SDK bundle** so an external
host application (the Cybertron WebPages app, via its `rnk-next` abstraction
layer) can embed it as a road-network rendering engine.

This document covers how to build the bundle, what it contains, and how the host
app consumes it.

## What the SDK is

The SDK exposes worldeditor-next's existing pieces through a fixed contract the
host registers at runtime:

- a **WebGPU renderer** factory (`ViewportRenderer`, wrapped to the host contract),
- a **WASM compute** surface (`we_wasm` bindings for parsing/geometry/picking),
- a **GeoZ importer** (`importGeoZ`).

Source of truth:

- Adapter: `frontend/src/integration/rnkNextSdk.ts`
- Build config: `frontend/vite.rnk-next.config.ts`

## Building the bundle

```bash
just build-rnk
```

This first builds the **slim** WASM package (`opendrive + render + pointcloud +
picking` only, no `extra-modules`) into `frontend/wasm/pkg-slim/`, then runs
`vite build --config vite.rnk-next.config.ts`. The vite config aliases the
shared `wasm/pkg/we_wasm` imports to `wasm/pkg-slim/we_wasm`, so the SDK bundle
embeds the slim build while the desktop editor keeps using the FULL build in
`frontend/wasm/pkg/`. The result is a single self-contained ESM file plus copied
static assets:

```
frontend/dist-rnk/
  we-next-sdk.js               # the SDK bundle (entry: createWorldEditorSdk)
  we-next-sdk.wasm             # the slim wasm-bindgen binary (copied from pkg-slim)
  assets/textures/**           # copied from frontend/public/ (signs, lights, paints)
  config/intents.json          # copied from frontend/public/
  favicon*.png, favicon.ico    # copied from frontend/public/
```

> `frontend/dist-rnk/` and `frontend/wasm/pkg-slim/` are **generated output** and
> are git-ignored. Do not commit them. The textures and config under dist-rnk
> are copies of `frontend/public/**`; that public folder is the source of truth.
> Rebuild with `just build-rnk` whenever the SDK source or public assets change.
> (`yarn build:rnk` alone only runs the vite step and assumes `pkg-slim` already
> exists.)

The WASM binary is emitted as `we-next-sdk.wasm` (the vite build copies
`pkg-slim/we_wasm_bg.wasm` under the unified vendor name) and is intentionally
**not** inlined. The host serves it as a separate asset and points the SDK at
its location (see below).

## Consuming the SDK from the host app

Once the bundle is vendored into the host project, register it with `rnk-next`:

```ts
import { createWorldEditorSdk } from 'worldeditor-next/rnkNextSdk';
import { registerWorldEditorSdk } from 'utils/rnk-next';

// `wasmInput` tells the SDK where to find the WASM binary. When vendored, the
// package-relative default path is no longer valid, so pass an explicit URL,
// a pre-fetched Request, or raw bytes/module.
registerWorldEditorSdk(
  await createWorldEditorSdk({
    wasmInput: new URL('/assets/we-next-sdk.wasm', window.location.origin),
  }),
);
```

`createWorldEditorSdk()` fully initializes (instantiates the WASM module) before
it resolves, so the synchronous WASM wrappers can be called immediately.

### `CreateWorldEditorSdkOptions`

| Option      | Type                                                                       | Notes                                                              |
| ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `wasmInput` | `string \| URL \| Request \| ArrayBuffer \| Uint8Array \| WebAssembly.Module` | Location of the emitted `we-next-sdk.wasm`. Defaults to the package-relative path. |

## Public surface

`createWorldEditorSdk()` returns a `WorldEditorSdk`:

```ts
interface WorldEditorSdk {
  createRenderer(): WorldEditorRenderer; // WebGPU renderer (2D/3D)
  wasm: WorldEditorWasm;                 // parse + geometry + picking
  geoz: WorldEditorGeoZ;                 // GeoZ importer
}
```

- **`createRenderer()`** — `init(canvas)`, `render()`, `resize()`, `setDimension('2d' | '3d')`,
  `set2DView()`, vertex uploads (`uploadRoadVertices`, `uploadLaneLineVertices`,
  `uploadHighlightVertices`, `uploadSpriteData`, `uploadPaintData`,
  `uploadOverlayVertices`), grid/axis/background config, `unprojectToGround()`,
  `fitToVertices()`, `toDataURL()`, and a texture manager (`getTextureManager()`,
  `waitForManifest()`).
- **`wasm`** — `parse_opendrive()`, road/lane/junction/object/center-line/paint
  vertex generators, `set_project_cache()` + `pick_lane_at_point_cached()`,
  `generate_lane_highlight_vertices()`, `get_project_bounds()`, and
  `generate_sprite_data()` for textured billboards.
- **`geoz`** — `importGeoZ(buffer, fileName?)`.

### Large 3DGS scenes (SOG)

A multi-GB PLY cannot be read with `file.arrayBuffer()` in a browser. The
renderer instead loads the compressed [SOG](https://github.com/playcanvas/splat-transform)
format (about 8x smaller, no splat is dropped), decoding WebP images in WASM:

- `loadGaussianSplatsSog(metaUrl, options?)` — unbundled `meta.json` + WebP images.
- `loadGaussianSplatsStreamed(lodMetaUrl, options?)` — `lod-meta.json` chunk set,
  decoded chunk by chunk and uploaded to the GPU incrementally, so the whole
  cloud is never resident in JS memory. Scenes above 16M splats use the GPU sort.

Both accept `GaussianSplatSogOptions` (`worldAligned`, `origin`, `signal`, `decodeWorkers`,
and for streamed `lod` / `onProgress`) and resolve with `GaussianSplatInfo`. Feature-detect
them (they are optional on `WorldEditorRenderer`). SOG v3 only; SH bands above 3 are dropped.

Download, WebP decode and GPU repacking run in a pool of Web Workers (up to 6, one
WASM instance each) so the page stays responsive while a large scene loads. Workers
need the `wasmInput` location passed to `createWorldEditorSdk` (relative URLs are
resolved against the page) and a CSP that allows `blob:` workers; otherwise loading
falls back to the main thread. `decodeWorkers: 0` forces the main thread.

PLY to SOG conversion and fidelity verification live in `tools/ply-to-sog/`
(`ply-to-sog.mjs --format streamed --verify-only --render-check`).

The GPU depth sort culls splats outside the view frustum (pixel-identical to
no culling) and sorts only the survivors, so frame time follows what the camera
sees rather than the cloud size. `setSplatFrustumCull(false)` (optional) turns the
culling off for diagnosis.

See `frontend/src/integration/rnkNextSdk.ts` for the authoritative type
definitions and JSDoc.

## Serving the WASM and texture assets

The host must serve, alongside the bundle:

1. `we-next-sdk.wasm` — referenced via `wasmInput`.
2. The contents of `dist-rnk/assets/textures/**` and `dist-rnk/config/intents.json`
   — the renderer's texture manager fetches the manifest and texture PNGs at the
   `basePath` declared in `assets/textures/manifest.json` (default `/assets/textures`).

If the host serves these from a different base path, ensure the manifest's
`basePath` and the served URLs line up.
