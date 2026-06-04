/**
 * snapshotCapture — Capture viewport as an image with configurable options.
 *
 * Uses renderer.captureFrame() to force a synchronous render and immediately
 * read the canvas content before the compositor expires the texture.
 *
 * Supports:
 * - Multiple formats (PNG, JPEG, WebP)
 * - Custom background color or transparent
 * - Resolution multiplier (1x, 2x, 4x)
 */
import { getViewportRenderer } from './viewportRef';

export interface SnapshotOptions {
  /** Image format. Default: 'png' */
  format: 'png' | 'jpeg' | 'webp';
  /** Background color (CSS color string). Used when transparent is false. */
  backgroundColor: string;
  /** Whether the background should be transparent. Only works with PNG/WebP. */
  transparent: boolean;
  /** Resolution scale multiplier (1 = current size, 2 = 2x, 4 = 4x). */
  scale: number;
  /** JPEG/WebP quality (0-1). Default: 0.92 */
  quality: number;
  /** Whether to auto-fit camera to show all content. Default: true */
  fitToContent: boolean;
}

export const DEFAULT_SNAPSHOT_OPTIONS: SnapshotOptions = {
  format: 'png',
  backgroundColor: '#1e1e2e',
  transparent: true,
  scale: 1,
  quality: 0.92,
  fitToContent: true,
};

function getMimeType(format: SnapshotOptions['format']): string {
  switch (format) {
    case 'png': return 'image/png';
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
  }
}

function getFileExtension(format: SnapshotOptions['format']): string {
  switch (format) {
    case 'png': return 'png';
    case 'jpeg': return 'jpg';
    case 'webp': return 'webp';
  }
}

/**
 * Load an image from a data URL. Returns a promise that resolves when the
 * image is fully decoded and ready for drawing.
 */
function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load canvas snapshot as image'));
    img.src = dataUrl;
  });
}

/**
 * Capture the viewport canvas as a Blob image.
 *
 * Strategy:
 * 1. Use renderer.captureFrame() to force a synchronous render + immediate readback
 *    (this avoids the WebGPU frame expiry issue with toDataURL)
 * 2. Composite background + scaling via OffscreenCanvas + 2D context
 *
 * Falls back to canvas.toDataURL() if the renderer is unavailable.
 */
export async function captureViewportSnapshot(
  canvas: HTMLCanvasElement,
  options: Partial<SnapshotOptions> = {},
): Promise<Blob> {
  const opts: SnapshotOptions = { ...DEFAULT_SNAPSHOT_OPTIONS, ...options };

  // JPEG does not support transparency
  const transparent = opts.format === 'jpeg' ? false : opts.transparent;

  const srcWidth = canvas.width;
  const srcHeight = canvas.height;
  const dstWidth = Math.round(srcWidth * opts.scale);
  const dstHeight = Math.round(srcHeight * opts.scale);

  const mimeType = getMimeType(opts.format);

  // Step 1: Get canvas content as data URL
  // Prefer renderer.captureFrame() which forces a sync render + immediate readback
  const renderer = getViewportRenderer();
  let dataUrl: string | null = null;
  if (renderer) {
    dataUrl = renderer.captureFrame({ transparent, fitToContent: opts.fitToContent });
  }
  // Fallback: try direct toDataURL (may return empty for expired WebGPU frames)
  if (!dataUrl || dataUrl === 'data:,') {
    dataUrl = canvas.toDataURL('image/png');
  }

  if (!dataUrl || dataUrl === 'data:,') {
    throw new Error('Failed to capture canvas content — canvas may be empty');
  }

  const img = await loadImageFromDataUrl(dataUrl);

  // Step 2: Composite onto OffscreenCanvas with background + scaling
  const offscreen = new OffscreenCanvas(dstWidth, dstHeight);
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas');
  }

  // Draw background if not transparent
  if (!transparent) {
    ctx.fillStyle = opts.backgroundColor;
    ctx.fillRect(0, 0, dstWidth, dstHeight);
  }

  // Draw the captured image (scaled to destination size)
  ctx.drawImage(img, 0, 0, srcWidth, srcHeight, 0, 0, dstWidth, dstHeight);

  // Step 3: Convert to target format blob
  const blob = await offscreen.convertToBlob({
    type: mimeType,
    quality: opts.format === 'png' ? undefined : opts.quality,
  });

  return blob;
}

/**
 * Trigger a file download from a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay to ensure download starts
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generate a default filename for the snapshot.
 */
export function generateSnapshotFilename(format: SnapshotOptions['format']): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `worldeditor-snapshot-${timestamp}.${getFileExtension(format)}`;
}

/**
 * Capture and download a viewport snapshot in one call.
 */
export async function captureAndDownload(
  canvas: HTMLCanvasElement,
  options: Partial<SnapshotOptions> = {},
): Promise<void> {
  const opts: SnapshotOptions = { ...DEFAULT_SNAPSHOT_OPTIONS, ...options };
  const blob = await captureViewportSnapshot(canvas, opts);
  const filename = generateSnapshotFilename(opts.format);
  downloadBlob(blob, filename);
}
