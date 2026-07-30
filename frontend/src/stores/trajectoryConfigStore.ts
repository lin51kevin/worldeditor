/**
 * Trajectory scene configuration store.
 *
 * Holds the mapping from trajectory actor ids (ego + opponents) to Gaussian
 * splat `.ply` models, the scanned PLY candidate list, and the optional
 * static-scene / trajectory references that together form a "logsim" scene
 * descriptor. The mapping + roots are persisted to localStorage (last-used
 * convenience) and can be exported / imported as a JSON descriptor.
 *
 * Async loading of the mapped PLYs into GPU-ready buffers lives in
 * {@link module:viewport/trajectoryActorModels} to keep this store free of
 * platform/worker imports; that module writes results back via `setLoadedModel`.
 */

import { create } from 'zustand';

/**
 * A PLY discovered by a directory scan. Desktop entries carry an absolute
 * `path`; web entries carry an in-memory `file` (browser sandbox — no path).
 * `key` is the stable identifier stored in the mapping (path on desktop, the
 * directory-relative path on web).
 */
export interface PlyCandidate {
  key: string;
  name: string;
  path?: string;
  file?: File;
  /** Displayable thumbnail URL (desktop: `convertFileSrc`, web: object URL). */
  thumbnail?: string;
}

/** Files discovered by a directory scan, grouped by role. */
export interface ScanResult {
  /** Opponent / ego model PLYs (from `assets/`), each with an optional thumbnail. */
  npcs: PlyCandidate[];
  /** Static scene reconstruction PLYs (`point_cloud.ply`). */
  scenes: PlyCandidate[];
  /** Road mesh PLYs (`road_mesh.ply`). */
  roads: PlyCandidate[];
  /** Trajectory CSV files. */
  trajectories: PlyCandidate[];
}

/** An actor id parsed from a scanned trajectory CSV. */
export interface ScanEntity {
  id: string;
  ego: boolean;
}

const EMPTY_SCAN: ScanResult = { npcs: [], scenes: [], roads: [], trajectories: [] };

/** A loaded, band-0, origin-recentred actor splat model ready to transform. */
export interface ActorSplatModel {
  /** The candidate key this model was loaded from (used to skip reloads). */
  key: string;
  /** Packed layout-v2 band-0 buffer in a local, recentred frame. */
  buffer: Uint32Array;
  /** Always 0 (models are unified to band-0 so they merge into one buffer). */
  shDegree: number;
  /** Splat count (`buffer.length / stride`). */
  count: number;
}

/** logsim scene descriptor — the export/import file format (`*.logsim.json`). */
export interface LogsimSceneConfig {
  version: 1;
  /** Root directory that was scanned for actor PLYs. */
  plyRoot?: string;
  /** Static reconstructed scene Gaussian PLY. */
  scenePly?: string;
  /** Trajectory file reference (path or name). */
  trajectory?: string;
  /** actorId → PLY key (path on desktop, relative path on web). */
  actorModels: Record<string, string>;
  /** Convenience defaults for auto-filling ego / opponent rows. */
  defaults?: { ego?: string; opponent?: string };
}

interface PersistedSlice {
  plyRoot: string | null;
  actorModels: Record<string, string>;
  defaults: { ego: string | null; opponent: string | null };
  scenePly: string | null;
  trajectoryRef: string | null;
}

interface TrajectoryConfigState extends PersistedSlice {
  /** Whether the floating config panel is visible. */
  configOpen: boolean;
  /** Whether the floating frame-rate stats HUD is visible (runtime only). */
  statsHudOpen: boolean;
  /** Discovered + classified files (runtime only — not persisted). */
  scan: ScanResult;
  /** Actor ids parsed from the scanned trajectory CSV (runtime only). */
  scanEntities: ScanEntity[];
  /** Loaded splat models keyed by actor id (runtime only). */
  loadedModels: Record<string, ActorSplatModel>;

  toggleConfigOpen: (open?: boolean) => void;
  /** Show / hide the frame-rate stats HUD (toggles when `open` is omitted). */
  toggleStatsHud: (open?: boolean) => void;
  setPlyRoot: (root: string | null) => void;
  setScan: (scan: ScanResult) => void;
  setScanEntities: (entities: ScanEntity[]) => void;
  /** Map an actor id to a candidate key, or clear it with `null`. */
  setActorModel: (actorId: string, key: string | null) => void;
  /** Set the ego / opponent default candidate key. */
  setDefault: (kind: 'ego' | 'opponent', key: string | null) => void;
  setScenePly: (key: string | null) => void;
  setTrajectoryRef: (ref: string | null) => void;
  /** Store / drop a loaded model buffer for an actor id. */
  setLoadedModel: (actorId: string, model: ActorSplatModel | null) => void;
  /** Drop every loaded model buffer (keeps the mapping). */
  clearLoadedModels: () => void;
  /** Serialize the current mapping into a logsim descriptor. */
  exportConfig: () => LogsimSceneConfig;
  /** Replace the mapping / roots from a logsim descriptor. */
  importConfig: (config: LogsimSceneConfig) => void;
  /** Reset everything to defaults (mapping, candidates, loaded models). */
  reset: () => void;
}

const STORAGE_KEY = 'we_traj_scene_config';

const EMPTY_PERSISTED: PersistedSlice = {
  plyRoot: null,
  actorModels: {},
  defaults: { ego: null, opponent: null },
  scenePly: null,
  trajectoryRef: null,
};

function loadPersisted(): PersistedSlice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_PERSISTED };
    const parsed = JSON.parse(raw) as Partial<PersistedSlice> | null;
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_PERSISTED };
    return {
      plyRoot: typeof parsed.plyRoot === 'string' ? parsed.plyRoot : null,
      actorModels:
        parsed.actorModels && typeof parsed.actorModels === 'object'
          ? { ...parsed.actorModels }
          : {},
      defaults: {
        ego: parsed.defaults?.ego ?? null,
        opponent: parsed.defaults?.opponent ?? null,
      },
      scenePly: typeof parsed.scenePly === 'string' ? parsed.scenePly : null,
      trajectoryRef: typeof parsed.trajectoryRef === 'string' ? parsed.trajectoryRef : null,
    };
  } catch (e) {
    console.warn('[trajConfig] Failed to load persisted scene config, resetting:', e);
    return { ...EMPTY_PERSISTED };
  }
}

function persist(state: PersistedSlice): void {
  const slice: PersistedSlice = {
    plyRoot: state.plyRoot,
    actorModels: state.actorModels,
    defaults: state.defaults,
    scenePly: state.scenePly,
    trajectoryRef: state.trajectoryRef,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  } catch (e) {
    console.warn('[trajConfig] Failed to persist scene config:', e);
  }
}

export const useTrajectoryConfigStore = create<TrajectoryConfigState>((set, get) => {
  /** Apply a persisted-slice patch, then flush the merged slice to storage. */
  const setPersisted = (patch: Partial<PersistedSlice>): void => {
    set(patch as Partial<TrajectoryConfigState>);
    const s = get();
    persist({
      plyRoot: s.plyRoot,
      actorModels: s.actorModels,
      defaults: s.defaults,
      scenePly: s.scenePly,
      trajectoryRef: s.trajectoryRef,
    });
  };

  return {
    ...loadPersisted(),
    configOpen: false,
    statsHudOpen: false,
    scan: EMPTY_SCAN,
    scanEntities: [],
    loadedModels: {},

    toggleConfigOpen: (open) =>
      set((s) => ({ configOpen: open ?? !s.configOpen })),

    toggleStatsHud: (open) =>
      set((s) => ({ statsHudOpen: open ?? !s.statsHudOpen })),

    setPlyRoot: (root) => setPersisted({ plyRoot: root }),

    setScan: (scan) => set({ scan }),

    setScanEntities: (entities) => set({ scanEntities: entities }),

    setActorModel: (actorId, key) =>
      setPersisted({
        actorModels: (() => {
          const next = { ...get().actorModels };
          if (key === null) delete next[actorId];
          else next[actorId] = key;
          return next;
        })(),
      }),

    setDefault: (kind, key) =>
      setPersisted({ defaults: { ...get().defaults, [kind]: key } }),

    setScenePly: (key) => setPersisted({ scenePly: key }),

    setTrajectoryRef: (ref) => setPersisted({ trajectoryRef: ref }),

    setLoadedModel: (actorId, model) =>
      set((s) => {
        const next = { ...s.loadedModels };
        if (model === null) delete next[actorId];
        else next[actorId] = model;
        return { loadedModels: next };
      }),

    clearLoadedModels: () => set({ loadedModels: {} }),

    exportConfig: () => {
      const s = get();
      const config: LogsimSceneConfig = {
        version: 1,
        actorModels: { ...s.actorModels },
      };
      if (s.plyRoot) config.plyRoot = s.plyRoot;
      if (s.scenePly) config.scenePly = s.scenePly;
      if (s.trajectoryRef) config.trajectory = s.trajectoryRef;
      if (s.defaults.ego || s.defaults.opponent) {
        config.defaults = {};
        if (s.defaults.ego) config.defaults.ego = s.defaults.ego;
        if (s.defaults.opponent) config.defaults.opponent = s.defaults.opponent;
      }
      return config;
    },

    importConfig: (config) => {
      // Importing invalidates any previously loaded model buffers.
      set({ loadedModels: {} });
      setPersisted({
        plyRoot: config.plyRoot ?? null,
        actorModels: { ...config.actorModels },
        defaults: {
          ego: config.defaults?.ego ?? null,
          opponent: config.defaults?.opponent ?? null,
        },
        scenePly: config.scenePly ?? null,
        trajectoryRef: config.trajectory ?? null,
      });
    },

    reset: () => {
      set({ scan: EMPTY_SCAN, scanEntities: [], loadedModels: {}, configOpen: false, statsHudOpen: false });
      setPersisted({ ...EMPTY_PERSISTED });
    },
  };
});
