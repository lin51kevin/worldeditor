/**
 * Sentinel error thrown by an exporter when the user cancels the native
 * "Save As" dialog. Callers should treat this as a no-op rather than a
 * failure (no success message, no error message).
 */
export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled by user');
    this.name = 'ExportCancelledError';
  }
}

/** Type guard for {@link ExportCancelledError}. */
export function isExportCancelled(error: unknown): boolean {
  return error instanceof ExportCancelledError || (error instanceof Error && error.name === 'ExportCancelledError');
}
