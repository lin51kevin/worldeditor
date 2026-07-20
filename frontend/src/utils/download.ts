/**
 * Trigger a browser file download from an in-memory Blob.
 *
 * Creates a temporary object URL, clicks a hidden anchor, then revokes
 * the URL to free memory.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** A native save-dialog file-type filter (Tauri desktop only). */
export interface SaveDialogFilter {
  /** Human-readable filter name, e.g. "GeoZ Map". */
  name: string;
  /** Extensions without the leading dot, e.g. ['geoz', 'zip']. */
  extensions: string[];
}

/** Detect whether the app is running inside the Tauri desktop shell. */
function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Extract the (dot-less, lowercase) extension from a filename. */
function extensionOf(filename: string): string {
  const leaf = filename.split(/[\\/]/).pop() ?? filename;
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : '';
}

/**
 * Persist exported data to disk.
 *
 * On the Tauri desktop build this shows the native "Save As" dialog and writes
 * the bytes to the user-chosen path; in the browser it falls back to a normal
 * download via {@link downloadBlob}.
 *
 * Throws {@link ExportCancelledError} when the user cancels the desktop dialog,
 * so callers can treat cancellation as a no-op rather than a failure.
 *
 * @param blob     The exported file contents (text or binary).
 * @param filename Suggested filename with extension, e.g. `map.geoz`.
 * @param filters  Optional save-dialog filters; defaults to a single filter
 *                 derived from the filename extension.
 */
export async function saveExport(
  blob: Blob,
  filename: string,
  filters?: SaveDialogFilter[],
): Promise<void> {
  if (!isTauriRuntime()) {
    downloadBlob(blob, filename);
    return;
  }

  const { ExportCancelledError } = await import('./exportErrors');
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');

  const ext = extensionOf(filename);
  const dialogFilters =
    filters ?? (ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined);

  const selected = await save({ defaultPath: filename, filters: dialogFilters });
  const path =
    typeof selected === 'string'
      ? selected
      : ((selected as { path?: string } | null)?.path ?? null);
  if (!path) {
    throw new ExportCancelledError();
  }

  const buffer = await blob.arrayBuffer();
  await writeFile(path, new Uint8Array(buffer));
}
