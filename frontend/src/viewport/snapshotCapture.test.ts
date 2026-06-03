import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  captureViewportSnapshot,
  downloadBlob,
  generateSnapshotFilename,
  DEFAULT_SNAPSHOT_OPTIONS,
} from './snapshotCapture';

// Mock viewportRef
vi.mock('./viewportRef', () => ({
  getViewportRenderer: vi.fn(() => ({
    captureFrame: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  })),
}));

// Mock Image so that onload fires immediately when src is set
class MockImage {
  width = 800;
  height = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  get src() { return this._src; }
  set src(value: string) {
    this._src = value;
    // Trigger onload asynchronously (microtask) to simulate real behavior
    Promise.resolve().then(() => {
      if (this.onload) this.onload();
    });
  }
}

// @ts-expect-error — mock global Image
globalThis.Image = MockImage;

// Mock OffscreenCanvas
class MockOffscreenCanvas {
  width: number;
  height: number;
  private ctx: MockContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = new MockContext();
  }

  getContext(_type: string) {
    return this.ctx;
  }

  async convertToBlob(options?: { type?: string; quality?: number }) {
    return new Blob(['mock-image-data'], { type: options?.type ?? 'image/png' });
  }
}

class MockContext {
  fillStyle = '';
  fillRect = vi.fn();
  drawImage = vi.fn();
}

// @ts-expect-error — mock global
globalThis.OffscreenCanvas = MockOffscreenCanvas;

describe('snapshotCapture', () => {
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    mockCanvas = {
      width: 800,
      height: 600,
      toDataURL: vi.fn(() => 'data:image/png;base64,mock'),
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => {
        cb(new Blob(['data'], { type: 'image/png' }));
      }),
    } as unknown as HTMLCanvasElement;
  });

  describe('captureViewportSnapshot', () => {
    it('should capture a PNG snapshot with default options', async () => {
      const blob = await captureViewportSnapshot(mockCanvas);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/png');
    });

    it('should capture a JPEG snapshot', async () => {
      const blob = await captureViewportSnapshot(mockCanvas, { format: 'jpeg' });
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/jpeg');
    });

    it('should capture a WebP snapshot', async () => {
      const blob = await captureViewportSnapshot(mockCanvas, { format: 'webp' });
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/webp');
    });

    it('should force non-transparent for JPEG format', async () => {
      const blob = await captureViewportSnapshot(mockCanvas, {
        format: 'jpeg',
        transparent: true,
      });
      expect(blob).toBeInstanceOf(Blob);
      // JPEG should still work (no transparency, so background is drawn)
    });

    it('should handle scale=2', async () => {
      const blob = await captureViewportSnapshot(mockCanvas, { scale: 2 });
      expect(blob).toBeInstanceOf(Blob);
    });

    it('should throw if OffscreenCanvas context fails', async () => {
      // Override OffscreenCanvas to return null context
      const OrigOC = globalThis.OffscreenCanvas;
      // @ts-expect-error — mock
      globalThis.OffscreenCanvas = class {
        constructor(public width: number, public height: number) {}
        getContext() { return null; }
      };
      await expect(captureViewportSnapshot(mockCanvas)).rejects.toThrow(
        'Failed to get 2D context from OffscreenCanvas',
      );
      // @ts-expect-error — restore
      globalThis.OffscreenCanvas = OrigOC;
    });
  });

  describe('downloadBlob', () => {
    it('should create and click an anchor element', () => {
      vi.useFakeTimers();
      const blob = new Blob(['test'], { type: 'image/png' });
      const createObjectURL = vi.fn(() => 'blob:mock-url');
      const revokeObjectURL = vi.fn();
      globalThis.URL.createObjectURL = createObjectURL;
      globalThis.URL.revokeObjectURL = revokeObjectURL;

      const appendChild = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
      const removeChild = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
      const clickFn = vi.fn();

      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        click: clickFn,
      } as unknown as HTMLAnchorElement);

      downloadBlob(blob, 'test.png');

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickFn).toHaveBeenCalled();

      // revokeObjectURL is called after a delay
      vi.advanceTimersByTime(1100);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      appendChild.mockRestore();
      removeChild.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('generateSnapshotFilename', () => {
    it('should generate filename with .png extension', () => {
      const filename = generateSnapshotFilename('png');
      expect(filename).toMatch(/^worldeditor-snapshot-.*\.png$/);
    });

    it('should generate filename with .jpg extension for jpeg', () => {
      const filename = generateSnapshotFilename('jpeg');
      expect(filename).toMatch(/^worldeditor-snapshot-.*\.jpg$/);
    });

    it('should generate filename with .webp extension', () => {
      const filename = generateSnapshotFilename('webp');
      expect(filename).toMatch(/^worldeditor-snapshot-.*\.webp$/);
    });
  });

  describe('DEFAULT_SNAPSHOT_OPTIONS', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_SNAPSHOT_OPTIONS.format).toBe('png');
      expect(DEFAULT_SNAPSHOT_OPTIONS.transparent).toBe(true);
      expect(DEFAULT_SNAPSHOT_OPTIONS.scale).toBe(1);
      expect(DEFAULT_SNAPSHOT_OPTIONS.quality).toBe(0.92);
    });
  });
});
