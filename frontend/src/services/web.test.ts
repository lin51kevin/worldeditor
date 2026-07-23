import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from './platform';
import { downloadBlob } from '../utils/download';
import { WebPlatformService } from './web';
import { APP_VERSION } from './index';
import * as wasmModule from '../../wasm/pkg/we_wasm';

vi.mock('../utils/download', () => ({
  downloadBlob: vi.fn(),
}));

vi.mock('../../wasm/pkg/we_wasm', () => ({
  default: vi.fn().mockResolvedValue(undefined),
  parse_opendrive: vi.fn(),
  write_opendrive: vi.fn(),
}));

function makeProject(): Project {
  return {
    name: 'Test Project',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('WebPlatformService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(wasmModule.default).mockResolvedValue(undefined as never);
    vi.mocked(wasmModule.parse_opendrive).mockReturnValue(makeProject() as never);
    vi.mocked(wasmModule.write_opendrive).mockReturnValue('<OpenDRIVE />' as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns web platform info', () => {
    expect(new WebPlatformService().getPlatformInfo()).toEqual({ type: 'web', version: APP_VERSION });
  });

  it('delegates OpenDRIVE parsing and writing to the WASM module after a single init', async () => {
    const service = new WebPlatformService();
    const project = makeProject();

    await expect(service.parseOpenDrive('<OpenDRIVE />')).resolves.toEqual(project);
    await expect(service.writeOpenDrive(project)).resolves.toBe('<OpenDRIVE />');

    expect(wasmModule.default).toHaveBeenCalledTimes(1);
    expect(wasmModule.parse_opendrive).toHaveBeenCalledWith('<OpenDRIVE />');
    expect(wasmModule.write_opendrive).toHaveBeenCalledWith(JSON.stringify(project));
  });

  it('rejects WASM-backed calls when the WASM module cannot be initialised', async () => {
    vi.mocked(wasmModule.default).mockRejectedValueOnce(new Error('WASM unavailable'));
    const service = new WebPlatformService();

    await expect(service.parseOpenDrive('<OpenDRIVE />')).rejects.toThrow('WASM unavailable');
    expect(wasmModule.parse_opendrive).not.toHaveBeenCalled();
  });

  it('opens a file picker and resolves the selected file contents', async () => {
    const service = new WebPlatformService();
    const originalCreateElement = document.createElement.bind(document);
    const input = originalCreateElement('input');
    const file = {
      name: 'network.xodr',
      text: vi.fn().mockResolvedValue('<OpenDRIVE />'),
    } as unknown as File;

    vi.spyOn(input, 'click').mockImplementation(() => {
      Object.defineProperty(input, 'files', {
        value: [file],
        configurable: true,
      });
      void input.onchange?.(new Event('change'));
    });

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'input') return input;
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    await expect(service.openFile()).resolves.toEqual({
      name: 'network.xodr',
      content: '<OpenDRIVE />',
    });

    expect(input.type).toBe('file');
    expect(input.accept).toBe('.xodr,.xml,.geoz');
    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it('returns null when the file picker closes without a selection', async () => {
    const service = new WebPlatformService();
    const originalCreateElement = document.createElement.bind(document);
    const input = originalCreateElement('input');

    vi.spyOn(input, 'click').mockImplementation(() => {
      Object.defineProperty(input, 'files', {
        value: [],
        configurable: true,
      });
      void input.onchange?.(new Event('change'));
    });

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'input') return input;
      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    await expect(service.openFile()).resolves.toBeNull();
  });

  it('returns null for openFileByPath because web platforms cannot access arbitrary paths', async () => {
    await expect(new WebPlatformService().openFileByPath('C:\\recent\\road.xodr')).resolves.toBeNull();
  });

  it('saves files by delegating to downloadBlob and returns the filename', async () => {
    const result = await new WebPlatformService().saveFile('saved.xodr', '<OpenDRIVE />');

    expect(result).toBe('saved.xodr');
    expect(downloadBlob).toHaveBeenCalledTimes(1);

    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0] ?? [];
    expect(filename).toBe('saved.xodr');
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).size).toBe(new Blob(['<OpenDRIVE />']).size);
    expect((blob as Blob).type).toBe('application/xml');
  });
});
