/**
 * useFileLoader — unified file loading hook with progress reporting.
 *
 * Orchestrates the full flow: file read → parse (via Worker for large files) →
 * mesh generation → setProject, updating loadingProgressStore at each phase.
 */

import { useCallback } from 'react';
import { useLoadingProgressStore } from '../stores/loadingProgressStore';
import { useProjectStore } from '../stores/projectStore';
import { getPlatformService } from '../services';
import type { Project } from '../services/platform';

/** Threshold (bytes) above which parsing is offloaded to Web Worker. */
const WORKER_THRESHOLD = 512 * 1024; // 512 KB

// ── Worker singleton ──────────────────────────────────────────────────────────
// A single Worker instance is reused across file loads so that the WASM module
// is initialised only once, reducing memory pressure when loading multiple files.
let sharedWorker: Worker | null = null;
let nextRequestId = 1;

type PendingRequest = {
  onProgress: (percent: number) => void;
  resolve: (project: Project) => void;
  reject: (err: Error) => void;
};
const pendingRequests = new Map<number, PendingRequest>();

function getSharedWorker(): Worker {
  if (sharedWorker) return sharedWorker;

  const worker = new Worker(
    new URL('../workers/opendrive.worker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent) => {
    const { type, requestId } = e.data as { type: string; requestId: number };
    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    switch (type) {
      case 'progress':
        pending.onProgress(e.data.percent as number);
        break;
      case 'result':
        pendingRequests.delete(requestId);
        pending.resolve(e.data.project as Project);
        break;
      case 'error':
        pendingRequests.delete(requestId);
        pending.reject(new Error(e.data.message as string));
        break;
    }
  };

  worker.onerror = (e) => {
    // Worker crashed — reject all in-flight requests and reset so a new
    // worker is created on the next call.
    const err = new Error(e.message || 'Worker crashed');
    for (const pending of pendingRequests.values()) {
      pending.reject(err);
    }
    pendingRequests.clear();
    sharedWorker = null;
  };

  sharedWorker = worker;
  return worker;
}

/**
 * Parse OpenDRIVE XML using the shared Web Worker for large files.
 * Falls back to main-thread WASM for small files.
 */
async function parseWithWorker(
  xml: string,
  fileName: string,
  onProgress: (percent: number) => void,
): Promise<Project> {
  return new Promise<Project>((resolve, reject) => {
    const requestId = nextRequestId++;
    pendingRequests.set(requestId, { onProgress, resolve, reject });
    getSharedWorker().postMessage({ type: 'parse', xml, fileName, requestId });
  });
}

interface FileLoaderResult {
  success: boolean;
  project?: Project;
  error?: string;
}

export function useFileLoader() {
  const loadFile = useCallback(async (
    content: string,
    fileName: string,
    options?: { skipStartLoading?: boolean },
  ): Promise<FileLoaderResult> => {
    const { startLoading, updateProgress, finishLoading, reset } =
      useLoadingProgressStore.getState();

    try {
      if (!options?.skipStartLoading) {
        startLoading(fileName);
        // Phase 1: Reading (already done by caller, just mark progress)
        updateProgress('reading', 10);

        // Yield a paint frame so the "reading" overlay is rendered before
        // we immediately overwrite it with "parsing".  Without this,
        // React 18 automatic batching merges both updates into one render.
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      }

      // Phase 2: Parsing
      updateProgress('parsing', 15);
      let project: Project;

      const fileSize = new Blob([content]).size;
      if (fileSize > WORKER_THRESHOLD) {
        // Large file → Worker
        project = await parseWithWorker(content, fileName, (percent) => {
          // Map worker progress (0-100) to our range (15-65)
          const mapped = 15 + (percent / 100) * 50;
          updateProgress('parsing', mapped);
        });
      } else {
        // Small file → main thread
        const ps = await getPlatformService();
        project = await ps.parseOpenDrive(content);
      }

      updateProgress('parsing', 65);

      // Phase 3: Commit project to store. Mesh generation is triggered
      // asynchronously by React effects — we finish loading immediately
      // so the overlay dismisses promptly, and the mesh renders in the background.
      project.name = fileName;
      useProjectStore.getState().setProject(project);
      finishLoading();

      return { success: true, project };
    } catch (err) {
      reset();
      const message = err instanceof Error ? err.message : String(err);
      console.error('[useFileLoader] Failed to load file:', message);
      return { success: false, error: message };
    }
  }, []);

  const loadFromDrop = useCallback(async (file: File): Promise<FileLoaderResult> => {
    const content = await file.text();
    return loadFile(content, file.name);
  }, [loadFile]);

  return { loadFile, loadFromDrop };
}
