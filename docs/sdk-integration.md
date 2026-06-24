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
cd frontend
yarn build:rnk
```

This runs `vite build --config vite.rnk-next.config.ts` and produces a single
self-contained ESM file plus copied static assets:

```
frontend/dist-rnk/
  worldeditor-next-sdk.js      # the SDK bundle (entry: createWorldEditorSdk)
  assets/textures/**           # copied from frontend/public/ (signs, lights, paints)
  config/intents.json          # copied from frontend/public/
  favicon*.png, favicon.ico    # copied from frontend/public/
```

> `frontend/dist-rnk/` is **generated output** and is git-ignored. Do not commit
> it. The textures and config under it are copies of `frontend/public/**`; that
> public folder is the source of truth. Rebuild with `yarn build:rnk` whenever
> the SDK source or public assets change.

The WASM binary (`we_wasm_bg.wasm`) is intentionally **not** inlined. The host
serves it as a separate asset and points the SDK at its location (see below).

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
    wasmInput: new URL('/assets/we_wasm_bg.wasm', window.location.origin),
  }),
);
```

`createWorldEditorSdk()` fully initializes (instantiates the WASM module) before
it resolves, so the synchronous WASM wrappers can be called immediately.

### `CreateWorldEditorSdkOptions`

| Option      | Type                                                                       | Notes                                                              |
| ----------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `wasmInput` | `string \| URL \| Request \| ArrayBuffer \| Uint8Array \| WebAssembly.Module` | Location of `we_wasm_bg.wasm`. Defaults to the package-relative path. |

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

See `frontend/src/integration/rnkNextSdk.ts` for the authoritative type
definitions and JSDoc.

## Serving the WASM and texture assets

The host must serve, alongside the bundle:

1. `we_wasm_bg.wasm` — referenced via `wasmInput`.
2. The contents of `dist-rnk/assets/textures/**` and `dist-rnk/config/intents.json`
   — the renderer's texture manager fetches the manifest and texture PNGs at the
   `basePath` declared in `assets/textures/manifest.json` (default `/assets/textures`).

If the host serves these from a different base path, ensure the manifest's
`basePath` and the served URLs line up.
