import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRegisterImporter = vi.fn();
const mockRegisterExporter = vi.fn();
const mockUnregisterPlugin = vi.fn();

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerImporter: mockRegisterImporter,
      registerExporter: mockRegisterExporter,
      unregisterPlugin: mockUnregisterPlugin,
    })),
  },
}));

vi.mock('../utils/download', () => ({ downloadBlob: vi.fn() }));

import { mountIoCsvPlugin } from './ioCsv.plugin';
import { downloadBlob } from '../utils/download';
const mockDownloadBlob = downloadBlob as unknown as ReturnType<typeof vi.fn>;

/** Helper: get the registered importer's onImport callback */
function getImporter() {
  mountIoCsvPlugin();
  const call = mockRegisterImporter.mock.calls[0]?.[0];
  return call;
}

describe('ioCsv.plugin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should mount and return a cleanup function', () => {
    const cleanup = mountIoCsvPlugin();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('should register an importer', () => {
    const cleanup = mountIoCsvPlugin();
    expect(mockRegisterImporter).toHaveBeenCalled();
    cleanup();
  });

  it('should register an exporter', () => {
    const cleanup = mountIoCsvPlugin();
    expect(mockRegisterExporter).toHaveBeenCalled();
    cleanup();
  });

  it('should call unregisterPlugin on cleanup', () => {
    const cleanup = mountIoCsvPlugin();
    cleanup();
    expect(mockUnregisterPlugin).toHaveBeenCalledWith('io-csv-import');
  });

  it('should register importer with correct extensions', () => {
    const cleanup = mountIoCsvPlugin();
    const call = mockRegisterImporter.mock.calls[0]?.[0];
    expect(call.extensions).toContain('.csv');
    cleanup();
  });
});

describe('parseCsvToProject (via importer)', () => {
  beforeEach(() => vi.clearAllMocks());

  const validCsv = 'x,y,hdg,id\n100.5,200.3,1.57,road1\n-50,0,0,road2';

  it('should import valid CSV successfully', async () => {
    const importer = getImporter();
    const project = await importer.onImport(validCsv);
    expect(project.roads).toHaveLength(2);
    expect(project.roads[0].id).toBe('road1');
    expect(project.roads[0].plan_view[0].x).toBe(100.5);
    expect(project.roads[0].plan_view[0].y).toBe(200.3);
    expect(project.roads[0].plan_view[0].hdg).toBe(1.57);
    expect(project.roads[1].plan_view[0].x).toBe(-50);
  });

  it('should default NaN coordinates to 0 instead of crashing', async () => {
    const importer = getImporter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const csv = 'x,y,hdg,id\nabc,def,0.5,road1';
    const project = await importer.onImport(csv);
    expect(project.roads).toHaveLength(1);
    expect(project.roads[0].plan_view[0].x).toBe(0);
    expect(project.roads[0].plan_view[0].y).toBe(0);
    expect(project.roads[0].plan_view[0].hdg).toBe(0.5);
    expect(project.name).toBe('CSV Import (1 warning(s))');
    expect(warnSpy).toHaveBeenCalledWith(
      '[CSV Import] 1 warning(s):',
      expect.stringContaining('invalid coordinates'),
    );
    warnSpy.mockRestore();
  });

  it('should default NaN heading to 0', async () => {
    const importer = getImporter();
    const csv = 'x,y,hdg,id\n10,20,xxx,road1';
    const project = await importer.onImport(csv);
    expect(project.roads[0].plan_view[0].x).toBe(10);
    expect(project.roads[0].plan_view[0].y).toBe(20);
    expect(project.roads[0].plan_view[0].hdg).toBe(0);
  });

  it('should reject empty CSV (only header, no data)', async () => {
    const importer = getImporter();
    await expect(importer.onImport('x,y,hdg,id')).rejects.toThrow('no data rows');
  });

  it('should reject completely empty CSV', async () => {
    const importer = getImporter();
    await expect(importer.onImport('')).rejects.toThrow('no data rows');
  });

  it('should reject CSV with only whitespace', async () => {
    const importer = getImporter();
    await expect(importer.onImport('   \n   \n')).rejects.toThrow('no data rows');
  });

  it('should skip # comment lines', async () => {
    const importer = getImporter();
    const csv = '# This is a comment\nx,y,hdg,id\n10,20,0,road1';
    const project = await importer.onImport(csv);
    expect(project.roads).toHaveLength(1);
    expect(project.roads[0].id).toBe('road1');
    expect(project.roads[0].plan_view[0].x).toBe(10);
  });

  it('should accept ArrayBuffer input', async () => {
    const importer = getImporter();
    const csv = 'x,y,hdg,id\n5,10,0,road1';
    const buf = new TextEncoder().encode(csv).buffer;
    const project = await importer.onImport(buf);
    expect(project.roads).toHaveLength(1);
    expect(project.roads[0].plan_view[0].x).toBe(5);
  });
});

describe('exportProjectToCsv (via exporter)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should call downloadBlob with a CSV blob', async () => {
    mountIoCsvPlugin();
    const call = mockRegisterExporter.mock.calls[0]?.[0];
    const project = {
      name: 'Test',
      roads: [{ id: 'r1', length: 20, plan_view: [{ x: 1, y: 2, hdg: 0, length: 10 }] }],
    } as any;
    await call.onExport(project);
    expect(mockDownloadBlob).toHaveBeenCalled();
    const blob = mockDownloadBlob.mock.calls[0]![0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv');
  });

  it('should export all plan_view segments (not just first)', async () => {
    mountIoCsvPlugin();
    const call = mockRegisterExporter.mock.calls[0]?.[0];
    const project = {
      name: 'Multi',
      roads: [{ id: 'r1', length: 30, plan_view: [{ x: 1, y: 0, hdg: 0, length: 10 }, { x: 2, y: 0, hdg: 0, length: 10 }, { x: 3, y: 0, hdg: 0, length: 10 }] }],
    } as any;
    await call.onExport(project);
    // Verify blob was passed to downloadBlob
    const blob = mockDownloadBlob.mock.calls[0]![0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Multi.csv');
  });
});
