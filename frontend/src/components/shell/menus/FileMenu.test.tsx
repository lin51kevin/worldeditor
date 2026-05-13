import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, Road } from '../../../services/platform';
import { useEditorStore } from '../../../stores/editorStore';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { getPlatformService } from '../../../services';
import { showAlert } from '../../../utils/dialog';
import { MenuBar } from '../MenuBar';

vi.mock('../../../services', () => ({
  getPlatformService: vi.fn(),
}));

vi.mock('../../../utils/dialog', () => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
  showConfirm: vi.fn().mockResolvedValue(true),
  showPrompt: vi.fn().mockResolvedValue('out.xodr'),
}));

function makeProject(roads: Road[] = [], name = 'Untitled'): Project {
  return {
    name,
    header: { rev_major: 1, rev_minor: 6, name: '', date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads,
    junctions: [],
    signals: [],
    objects: [],
  };
}

function createPlatformMock() {
  return {
    platform: {
      getPlatformInfo: () => ({ type: 'web', version: '0.1.0' }),
    } as any,
  };
}

describe('FileMenu import/export error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(showAlert).mockResolvedValue(undefined);
    vi.mocked(getPlatformService).mockResolvedValue(createPlatformMock().platform);
    act(() => {
      useEditorStore.setState({ project: makeProject([{ id: 'r1', name: 'R1', length: 10, junction_id: null, link: { predecessor: null, successor: null }, plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], elevation_profile: [], lane_sections: [] }]), isDirty: false });
      // Clear leftover plugins
      usePluginContribStore.getState().importers.forEach(i => usePluginContribStore.getState().unregisterImporter(i.id));
      usePluginContribStore.getState().exporters.forEach(e => usePluginContribStore.getState().unregisterExporter(e.id));
    });
  });

  async function openImportMenu() {
    render(<MenuBar />);
    fireEvent.click(screen.getByTitle('文件'));
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('导入'));
  }

  async function openExportMenu() {
    render(<MenuBar />);
    fireEvent.click(screen.getByTitle('文件'));
    fireEvent.click(screen.getByText('文件'));
    fireEvent.click(screen.getByText('导出'));
  }

  function simulateFileInput(filename: string, _ext: string) {
    // The component creates <input> via document.createElement inside the click handler.
    // We intercept createElement before the click to capture it.
    const inputs: HTMLInputElement[] = [];
    const origCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'input') inputs.push(el as HTMLInputElement);
      return el;
    });
    return {
      cleanup: () => spy.mockRestore(),
      trigger: async () => {
        const input = inputs[inputs.length - 1];
        expect(input).toBeTruthy();
        const file = new File(['data'], filename, { type: 'application/octet-stream' });
        Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(4)), writable: false });
        Object.defineProperty(input, 'files', { value: [file], writable: false });
        // Directly invoke the onchange handler (jsdom doesn't bubble change events to inline handlers)
        await act(async () => {
          await input!.onchange?.(new Event('change'));
        });
      },
    };
  }

  it('shows success alert after successful plugin import', async () => {
    act(() => {
      usePluginContribStore.getState().registerImporter({
        id: 'imp-ok', pluginId: 't', formatName: 'OSM', extensions: ['.osm'],
        onImport: async () => makeProject([{ id: 'r1', name: '', length: 10, junction_id: null, link: null, plan_view: [{ s: 0, x: 0, y: 0, hdg: 0, length: 10, geo_type: 'Line' }], elevation_profile: [], lane_sections: [] }], 'imported'),
      });
    });

    await openImportMenu();
    const imp = simulateFileInput('test.osm', '.osm');
    fireEvent.click(screen.getByText('导入 OSM...'));
    await imp.trigger();
    imp.cleanup();

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledWith(expect.stringContaining('test.osm'), expect.stringContaining('成功')));
  });

  it('shows error alert when plugin import throws', async () => {
    act(() => {
      usePluginContribStore.getState().registerImporter({
        id: 'imp-err', pluginId: 't', formatName: 'Bad', extensions: ['.bad'],
        onImport: async () => { throw new Error('corrupt file'); },
      });
    });

    await openImportMenu();
    const bad = simulateFileInput('fail.bad', '.bad');
    fireEvent.click(screen.getByText('导入 Bad...'));
    await bad.trigger();
    bad.cleanup();

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledWith(expect.stringContaining('corrupt file'), expect.stringContaining('错误')));
  });

  it('shows error alert when plugin import returns invalid project (no roads)', async () => {
    act(() => {
      usePluginContribStore.getState().registerImporter({
        id: 'imp-inv', pluginId: 't', formatName: 'Inv', extensions: ['.inv'],
        onImport: async () => null as unknown as Project,
      });
    });

    await openImportMenu();
    const inv = simulateFileInput('inv.inv', '.inv');
    fireEvent.click(screen.getByText('导入 Inv...'));
    await inv.trigger();
    inv.cleanup();

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledWith(expect.stringContaining('无效'), expect.stringContaining('错误')));
  });

  it('shows success alert after successful plugin export', async () => {
    act(() => {
      usePluginContribStore.getState().registerExporter({
        id: 'exp-ok', pluginId: 't', formatName: 'CSV',
        onExport: vi.fn().mockResolvedValue(undefined),
      });
    });

    await openExportMenu();
    fireEvent.click(screen.getByText('导出 CSV...'));

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledWith(expect.stringContaining('CSV'), expect.stringContaining('成功')));
  });

  it('shows error alert when plugin export throws', async () => {
    act(() => {
      usePluginContribStore.getState().registerExporter({
        id: 'exp-err', pluginId: 't', formatName: 'DXF',
        onExport: vi.fn().mockRejectedValue(new Error('disk full')),
      });
    });

    await openExportMenu();
    fireEvent.click(screen.getByText('导出 DXF...'));

    await waitFor(() => expect(vi.mocked(showAlert)).toHaveBeenCalledWith(expect.stringContaining('DXF'), expect.stringContaining('错误')));
  });
});
