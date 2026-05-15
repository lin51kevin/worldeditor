/**
 * Factory for creating IO (importer/exporter) plugins with minimal boilerplate.
 *
 * Each IO plugin shares identical mount/unmount logic — only the format name,
 * extensions, and actual import/export callbacks differ.
 */

import { usePluginContribStore } from '../stores/pluginContribStore';
import type { Project } from '../services/platform';

export interface IOPluginConfig {
  /** Plugin id, e.g. 'io-csv'. */
  pluginId: string;
  /** Importer config. Omit entirely if no import capability. */
  importer?: {
    formatName: string;
    extensions: string[];
    disabled?: boolean;
    onImport: (content: string | ArrayBuffer, fileName: string) => Promise<Project>;
  };
  /** Exporter config. Omit entirely if no export capability. */
  exporter?: {
    formatName: string;
    disabled?: boolean;
    onExport: (project: Project) => Promise<void>;
  };
}

/**
 * Create a mount function for an IO plugin.
 *
 * Usage:
 * ```ts
 * export const mountIoCsvPlugin = createIOPlugin({
 *   pluginId: 'io-csv',
 *   importer: { formatName: 'CSV Coordinates', extensions: ['.csv', '.txt'], onImport: parseCsvToProject },
 *   exporter: { formatName: 'CSV Coordinates', onExport: exportProjectToCsv },
 * });
 * ```
 */
export function createIOPlugin(config: IOPluginConfig): () => () => void {
  return () => {
    const { registerImporter, registerExporter, unregisterPlugin } =
      usePluginContribStore.getState();

    if (config.importer) {
      registerImporter({
        id: `${config.pluginId}:importer`,
        pluginId: config.pluginId,
        formatName: config.importer.formatName,
        extensions: config.importer.extensions,
        disabled: config.importer.disabled ?? false,
        onImport: config.importer.onImport,
      });
    }

    if (config.exporter) {
      registerExporter({
        id: `${config.pluginId}:exporter`,
        pluginId: config.pluginId,
        formatName: config.exporter.formatName,
        disabled: config.exporter.disabled ?? false,
        onExport: config.exporter.onExport,
      });
    }

    return () => unregisterPlugin(config.pluginId);
  };
}

/**
 * Create a disabled IO plugin stub for formats not yet implemented.
 *
 * Usage:
 * ```ts
 * export const mountIoDxfPlugin = createIOPluginStub({
 *   pluginId: 'io-dxf',
 *   formatName: 'DXF CAD',
 *   extensions: ['.dxf'],
 *   phase: 3,
 * });
 * ```
 */
export function createIOPluginStub(opts: {
  pluginId: string;
  formatName: string;
  extensions: string[];
  phase?: number;
}): () => () => void {
  const msg = `${opts.formatName} requires Phase ${opts.phase ?? 3}`;
  return createIOPlugin({
    pluginId: opts.pluginId,
    importer: {
      formatName: opts.formatName,
      extensions: opts.extensions,
      disabled: true,
      onImport: () => Promise.reject(new Error(msg)),
    },
    exporter: {
      formatName: opts.formatName,
      disabled: true,
      onExport: () => Promise.reject(new Error(msg)),
    },
  });
}
