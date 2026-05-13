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
