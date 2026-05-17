import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConverterPanel from './ConverterPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import type { Project } from '../../../services/platform';

function makeProject(): Project {
  return {
    name: 'converted',
    header: { name: 'converted', rev_major: 1, rev_minor: 0, date: '', north: 0, south: 0, east: 0, west: 0, geo_reference: null },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
  };
}

beforeEach(() => {
  // Polyfill Blob.arrayBuffer — jsdom in this environment doesn't implement it
  if (!('arrayBuffer' in Blob.prototype)) {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value(this: Blob) {
        return new Promise<ArrayBuffer>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
  usePluginContribStore.setState({
    toolbarButtons: [], menuItems: [], templateSections: [],
    importers: [], exporters: [], panels: [], contextMenuItems: [],
    viewportOverlays: [], settingsContribs: [],
    panelTabVisibility: {}, activeTabId: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConverterPanel', () => {
  it('renders "Batch Converter" title', () => {
    render(<ConverterPanel />);
    expect(screen.getByText('Batch Converter')).toBeInTheDocument();
  });

  it('shows "No files selected" when no files are chosen', () => {
    render(<ConverterPanel />);
    expect(screen.getByText('No files selected')).toBeInTheDocument();
  });

  it('Convert button is disabled with no files, importers, or exporters', () => {
    render(<ConverterPanel />);
    expect(screen.getByRole('button', { name: 'Convert' })).toBeDisabled();
  });

  it('shows Source Format and Target Format labels', () => {
    render(<ConverterPanel />);
    expect(screen.getByText('Source Format')).toBeInTheDocument();
    expect(screen.getByText('Target Format')).toBeInTheDocument();
  });

  it('shows Input Files label', () => {
    render(<ConverterPanel />);
    expect(screen.getByText('Input Files')).toBeInTheDocument();
  });

  it('auto-selects first importer and exporter when registered', () => {
    act(() => {
      usePluginContribStore.setState({
        importers: [
          { id: 'imp1', pluginId: 'p', formatName: 'OpenDRIVE', extensions: ['.xodr'], onImport: vi.fn() },
        ],
        exporters: [
          { id: 'exp1', pluginId: 'p', formatName: 'OBJ 3D', onExport: vi.fn() },
        ],
      });
    });
    render(<ConverterPanel />);
    expect(screen.getByDisplayValue('OpenDRIVE')).toBeInTheDocument();
    expect(screen.getByDisplayValue('OBJ 3D')).toBeInTheDocument();
  });

  it('renders all enabled importers in Source select', () => {
    act(() => {
      usePluginContribStore.setState({
        importers: [
          { id: 'i1', pluginId: 'p', formatName: 'CSV', extensions: ['.csv'], onImport: vi.fn() },
          { id: 'i2', pluginId: 'p', formatName: 'MIF', extensions: ['.mif'], onImport: vi.fn() },
          { id: 'i3', pluginId: 'p', formatName: 'Disabled Format', extensions: [], disabled: true, onImport: vi.fn() },
        ],
        exporters: [],
      });
    });
    render(<ConverterPanel />);
    expect(screen.getByRole('option', { name: 'CSV' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'MIF' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Disabled Format' })).not.toBeInTheDocument();
  });

  it('Convert button is disabled when files are selected but no importers/exporters', () => {
    render(<ConverterPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.xodr', { type: 'text/xml' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByRole('button', { name: 'Convert' })).toBeDisabled();
  });

  it('shows file count after selecting files', () => {
    render(<ConverterPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'test.xodr', { type: 'text/xml' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText('1 file(s) selected')).toBeInTheDocument();
  });

  it('shows success log entry after successful conversion', async () => {
    const mockImport = vi.fn().mockResolvedValue(makeProject());
    const mockExport = vi.fn().mockResolvedValue(undefined);
    act(() => {
      usePluginContribStore.setState({
        importers: [{ id: 'i1', pluginId: 'p', formatName: 'OpenDRIVE', extensions: ['.xodr'], onImport: mockImport }],
        exporters: [{ id: 'e1', pluginId: 'p', formatName: 'OBJ', onExport: mockExport }],
      });
    });
    render(<ConverterPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['xodr content'], 'road.xodr', { type: 'text/xml' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText('road.xodr')).toBeInTheDocument();
      expect(screen.getByText(/OpenDRIVE → OBJ/)).toBeInTheDocument();
    });
  });

  it('shows error log entry when importer throws', async () => {
    const mockImport = vi.fn().mockRejectedValue(new Error('Parse failed'));
    const mockExport = vi.fn().mockResolvedValue(undefined);
    act(() => {
      usePluginContribStore.setState({
        importers: [{ id: 'i1', pluginId: 'p', formatName: 'OpenDRIVE', extensions: ['.xodr'], onImport: mockImport }],
        exporters: [{ id: 'e1', pluginId: 'p', formatName: 'OBJ', onExport: mockExport }],
      });
    });
    render(<ConverterPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bad content'], 'bad.xodr', { type: 'text/xml' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText('bad.xodr')).toBeInTheDocument();
      expect(screen.getByText('Parse failed')).toBeInTheDocument();
    });
  });

  it('shows error when file exceeds 50 MB limit', async () => {
    const mockImport = vi.fn().mockResolvedValue(makeProject());
    const mockExport = vi.fn().mockResolvedValue(undefined);
    act(() => {
      usePluginContribStore.setState({
        importers: [{ id: 'i1', pluginId: 'p', formatName: 'OpenDRIVE', extensions: ['.xodr'], onImport: mockImport }],
        exporters: [{ id: 'e1', pluginId: 'p', formatName: 'OBJ', onExport: mockExport }],
      });
    });
    render(<ConverterPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    // Create a file object with a large size
    const file = new File(['x'], 'huge.xodr', { type: 'text/xml' });
    Object.defineProperty(file, 'size', { value: 60 * 1024 * 1024 });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText(/50 MB limit/)).toBeInTheDocument();
    });
  });
});
