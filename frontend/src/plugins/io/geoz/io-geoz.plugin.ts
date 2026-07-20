/**
 * GeoZ import plugin.
 * Registers the GeoZ importer contribution.
 * Uses Web Worker for files > 5 MB to avoid UI freezing.
 */

import { importGeoZ } from './parser';
import { createIOPlugin } from '../../core/ioPluginFactory';
import { saveExport } from '../../../utils/download';
import type { Project } from '../../../services/platform';

export { buildGeoZProtoRoot, geoToProject, importGeoZ } from './parser';

/** Files larger than this threshold (5 MB) are parsed in a Web Worker. */
const WORKER_SIZE_THRESHOLD = 5 * 1024 * 1024;

/**
 * Parse a GeoZ file, optionally offloading to a Web Worker for large files.
 *
 * For small files, calls `importGeoZ` directly on the main thread.
 * For large files, sends the buffer to parser.worker.ts and reconstructs
 * the Project from decoded protobuf data on the main thread.
 */
async function importGeoZWithWorker(
  fileContent: string | ArrayBuffer,
  fileName = 'GeoZ Map',
) {
  // Small files or string content → main thread
  if (typeof fileContent === 'string' || fileContent.byteLength <= WORKER_SIZE_THRESHOLD) {
    return importGeoZ(fileContent, fileName);
  }

  // Large ArrayBuffer → Web Worker
  const worker = new Worker(
    new URL('../../workers/parser.worker.ts', import.meta.url),
    { type: 'module' },
  );

  try {
    const result = await new Promise<{ type: string; data?: unknown; message?: string }>(
      (resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage(
          { type: 'parse-geoz', buffer: fileContent, fileName },
          [fileContent], // Transfer ownership — zero-copy
        );
      },
    );

    if (result.type === 'error') {
      throw new Error(result.message ?? 'Worker parsing failed');
    }

    const { protoTopoFiles, protoGeoFiles } = result.data as {
      protoTopoFiles: Record<string, unknown>[];
      protoGeoFiles: { stem: string; data: Record<string, unknown> }[];
      fileName: string;
    };

    // Use the main-thread geoToProject with decoded proto data
    const { geoToProject } = await import('./parser');
    return geoToProject(protoTopoFiles, protoGeoFiles, fileName);
  } finally {
    worker.terminate();
  }
}

/**
 * Export the current project to a GeoZ (`.geoz`) archive.
 *
 * Delegates the protobuf encoding + ZIP packaging to the Rust/WASM
 * `export_to_geoz` implementation, then saves via the platform-aware helper
 * (native "Save As" dialog on desktop, browser download on web).
 */
async function exportGeoZ(project: Project): Promise<void> {
  const wasm = await import('../../../../wasm/pkg/we_wasm');
  const bytes = wasm.export_to_geoz(JSON.stringify(project)) as Uint8Array;
  const payload = bytes.slice().buffer;
  const blob = new Blob([payload], { type: 'application/zip' });
  await saveExport(blob, `${project.name || 'worldeditor'}.geoz`, [
    { name: 'GeoZ Map', extensions: ['geoz', 'zip'] },
  ]);
}

export const mountIoGeoZPlugin = createIOPlugin({
  pluginId: 'io-geoz-import',
  importer: {
    formatName: 'GeoZ Map',
    extensions: ['.geoz', '.zip'],
    onImport: importGeoZWithWorker,
  },
  exporter: {
    formatName: 'GeoZ Map',
    onExport: exportGeoZ,
  },
});
