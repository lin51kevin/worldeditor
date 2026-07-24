/**
 * Directory scan + classification for the trajectory scene config.
 *
 * A scanned data root is expected to contain, per rendering variant
 * (`3dgs/` · `4dgs/` · `nurec/`):
 *  - `point_cloud.ply` — the static reconstructed scene,
 *  - `road_mesh.ply`   — the road surface,
 *  - a trajectory `*.csv`,
 * and an `assets/` folder of opponent / ego model PLYs, each optionally paired
 * with a same-directory thumbnail image (matched by base name, else the first
 * image in that folder).
 *
 * Classification is platform-aware: desktop resolves absolute paths (thumbnails
 * via `convertFileSrc`, CSV via `openFileByPath`); web works from picked `File`
 * handles (thumbnails via object URLs, CSV via `File.text()`).
 */

import { getPlatformService } from '../services';
import type { PlyCandidate, ScanResult, ScanEntity } from '../stores/trajectoryConfigStore';
import { parseTraj } from '../plugins/npc-actors';

/** Extensions collected by a scan (models, thumbnails, trajectories). */
export const SCAN_EXTENSIONS = ['ply', 'csv', 'png', 'jpg', 'jpeg', 'webp'];

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const EMPTY_SCAN: ScanResult = { npcs: [], scenes: [], roads: [], trajectories: [] };

/** A raw scanned file before classification. `rel` is `/`-normalised. */
interface RawFile {
  key: string;
  name: string;
  rel: string;
  path?: string;
  file?: File;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function extOf(rel: string): string {
  const dot = rel.lastIndexOf('.');
  return dot >= 0 ? rel.slice(dot + 1).toLowerCase() : '';
}

function baseOf(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return (slash >= 0 ? rel.slice(slash + 1) : rel).toLowerCase();
}

function dirOf(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return slash >= 0 ? rel.slice(0, slash) : '';
}

/** Base name without its extension, for thumbnail matching. */
function stem(rel: string): string {
  const b = baseOf(rel);
  const dot = b.lastIndexOf('.');
  return dot >= 0 ? b.slice(0, dot) : b;
}

/** Path of `rel` relative to `root` (both `/`-normalised); falls back to `rel`. */
function relativeTo(rel: string, root: string): string {
  if (!root) return rel;
  const r = root.endsWith('/') ? root.slice(0, -1) : root;
  if (rel === r) return baseOf(rel);
  if (rel.startsWith(r + '/')) return rel.slice(r.length + 1);
  return rel;
}

/**
 * Classify raw scanned files into scene / road / trajectory / npc buckets,
 * attaching a thumbnail URL (built by `toThumbUrl`) to each npc model. Display
 * names are the file's path relative to `root` so ambiguous same-named files in
 * different variant folders stay distinguishable.
 */
function classify(files: RawFile[], root: string, toThumbUrl: (f: RawFile) => string): ScanResult {
  const imagesByDir = new Map<string, RawFile[]>();
  for (const f of files) {
    if (IMAGE_EXTS.has(extOf(f.rel))) {
      const d = dirOf(f.rel);
      const list = imagesByDir.get(d);
      if (list) list.push(f);
      else imagesByDir.set(d, [f]);
    }
  }

  const result: ScanResult = { npcs: [], scenes: [], roads: [], trajectories: [] };
  for (const f of files) {
    const ext = extOf(f.rel);
    const base = baseOf(f.rel);
    const name = relativeTo(f.rel, root);
    const candidate: PlyCandidate = { key: f.key, name, path: f.path, file: f.file };

    if (ext === 'csv') {
      result.trajectories.push(candidate);
    } else if (ext !== 'ply') {
      continue; // images handled via imagesByDir
    } else if (base === 'point_cloud.ply') {
      result.scenes.push(candidate);
    } else if (base === 'road_mesh.ply') {
      result.roads.push(candidate);
    } else {
      // Any other PLY is treated as an actor model; prefer those under assets/.
      const images = imagesByDir.get(dirOf(f.rel)) ?? [];
      const thumb =
        images.find((img) => stem(img.rel) === stem(f.rel)) ?? images[0];
      result.npcs.push({ ...candidate, thumbnail: thumb ? toThumbUrl(thumb) : undefined });
    }
  }
  return result;
}

/** Parse the first trajectory CSV (if any) into actor id / ego entities. */
async function parseEntities(
  trajectories: PlyCandidate[],
  readText: (c: PlyCandidate) => Promise<string>,
): Promise<ScanEntity[]> {
  const first = trajectories[0];
  if (!first) return [];
  try {
    const data = parseTraj(await readText(first));
    return data.entities.map((e) => ({ id: e.id, ego: e.ego }));
  } catch (err) {
    console.warn('[trajScan] Failed to parse trajectory CSV:', err);
    return [];
  }
}

/** Desktop: scan an absolute directory and classify its contents. */
export async function scanAndClassify(
  dir: string,
): Promise<{ scan: ScanResult; entities: ScanEntity[] }> {
  const platform = await getPlatformService();
  if (!platform.scanDirectory) return { scan: EMPTY_SCAN, entities: [] };
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const files = await platform.scanDirectory(dir, SCAN_EXTENSIONS);
  const raw: RawFile[] = files.map((f) => ({
    key: f.path,
    name: f.name,
    rel: normalize(f.path),
    path: f.path,
  }));
  const scan = classify(raw, normalize(dir), (f) => convertFileSrc(f.path!));
  const entities = await parseEntities(scan.trajectories, async (c) => {
    const opened = await platform.openFileByPath(c.path!);
    return opened?.content ?? '';
  });
  return { scan, entities };
}

/** Web: classify files chosen via a directory picker. */
export async function classifyWebFiles(
  fileList: FileList,
): Promise<{ scan: ScanResult; entities: ScanEntity[] }> {
  const raw: RawFile[] = Array.from(fileList).map((file) => {
    const rel = normalize(
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    );
    return { key: rel, name: baseOf(rel).length ? file.name : rel, rel, file };
  });
  // webkitRelativePath already includes the picked folder as the first segment,
  // so it is used verbatim as the relative display name.
  const scan = classify(raw, '', (f) => URL.createObjectURL(f.file!));
  const entities = await parseEntities(scan.trajectories, (c) => c.file!.text());
  return { scan, entities };
}
