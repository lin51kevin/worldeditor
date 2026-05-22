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

interface FileLoaderResult {
  success: boolean;
  project?: Project;
  error?: string;
}

/**
 * Parse OpenDRIVE XML using a Web Worker for large files.
 * Falls back to main-thread WASM for small files.
 */
async function parseWithWorker(
  xml: string,
  fileName: string,
  onProgress: (percent: number) => void,
): Promise<Project> {
  return new Promise<Project>((resolve, reject) => {
    const worker = new Worker(
      new URL('../workers/opendrive.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      switch (type) {
        case 'progress':
          onProgress(e.data.percent);
          break;
        case 'result':
          worker.terminate();
          resolve(e.data.project as Project);
          break;
        case 'error':
          worker.terminate();
          reject(new Error(e.data.message));
          break;
      }
    };

    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker error'));
    };

    worker.postMessage({ type: 'parse', xml, fileName });
  });
}

export function useFileLoader() {
  const loadFile = useCallback(async (
    content: string,
    fileName: string,
  ): Promise<FileLoaderResult> => {
    const { startLoading, updateProgress, finishLoading, reset } =
      useLoadingProgressStore.getState();

    try {
      startLoading(fileName);

      // Phase 1: Reading (already done by caller, just mark progress)
      updateProgress('reading', 10);

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

      // Phase 3: Generating mesh (happens automatically when setProject triggers re-render)
      updateProgress('generating-mesh', 70);
      project.name = fileName;
      useProjectStore.getState().setProject(project);

      // Mesh generation is async and triggered by React effect, so we estimate progress
      updateProgress('generating-mesh', 90);

      // Brief delay to allow mesh generation to begin, then mark complete
      await new Promise((r) => setTimeout(r, 100));
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
