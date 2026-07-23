import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SnapshotExportDialog } from './SnapshotExportDialog';

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'snapshot.title': 'Export Snapshot',
        'snapshot.exportPath': 'Export Path',
        'snapshot.browse': 'Browse',
        'snapshot.format': 'Format',
        'snapshot.backgroundColor': 'Background',
        'snapshot.transparent': 'Transparent',
        'snapshot.jpegNoTransparent': "JPEG doesn't support transparency",
        'snapshot.fitToContent': 'Fit to Content',
        'snapshot.resolution': 'Resolution',
        'snapshot.custom': 'Custom',
        'snapshot.quality': 'Quality',
        'snapshot.outputSize': 'Output size',
        'snapshot.generatingPreview': 'Generating preview...',
        'snapshot.export': 'Export',
        'snapshot.exporting': 'Exporting...',
        'common.close': 'Close',
        'common.cancel': 'Cancel',
      };
      return translations[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Mock snapshotCapture
vi.mock('../../viewport/snapshotCapture', () => ({
  captureViewportSnapshot: vi.fn(async () => new Blob(['mock'], { type: 'image/png' })),
  downloadBlob: vi.fn(),
  generateSnapshotFilename: vi.fn(() => 'test-snapshot.png'),
  DEFAULT_SNAPSHOT_OPTIONS: {
    format: 'png',
    backgroundColor: '#1e1e2e',
    transparent: true,
    scale: 1,
    quality: 0.92,
  },
}));

// Mock platform service
vi.mock('../../services', () => ({
  getPlatformService: vi.fn(async () => ({
    getPlatformInfo: () => ({ type: 'web', version: '0.4.0' }),
  })),
}));

// Mock viewport canvas in DOM
beforeEach(() => {
  // Create a mock canvas element
  const mockCanvas = document.createElement('canvas');
  mockCanvas.className = 'viewport-canvas';
  Object.defineProperty(mockCanvas, 'width', { value: 800, writable: true });
  Object.defineProperty(mockCanvas, 'height', { value: 600, writable: true });
  document.body.appendChild(mockCanvas);

  return () => {
    document.body.removeChild(mockCanvas);
  };
});

describe('SnapshotExportDialog', () => {
  it('should not render when open is false', () => {
    const { container } = render(
      <SnapshotExportDialog open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('should render dialog when open is true', () => {
    render(<SnapshotExportDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText('Export Snapshot')).toBeInTheDocument();
  });

  it('should show format selector with PNG/JPEG/WebP options', () => {
    render(<SnapshotExportDialog open={true} onClose={vi.fn()} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((o) => o.value)).toEqual(['png', 'jpeg', 'webp']);
  });

  it('should show resolution radio buttons', () => {
    render(<SnapshotExportDialog open={true} onClose={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(4); // 1x, 2x, 4x, Custom
  });

  it('should disable transparent checkbox when JPEG is selected', () => {
    render(<SnapshotExportDialog open={true} onClose={vi.fn()} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'jpeg' } });
    const checkboxes = screen.getAllByRole('checkbox');
    // First checkbox is transparent
    expect(checkboxes[0]).toBeDisabled();
  });

  it('should show custom size inputs when Custom is selected', () => {
    render(<SnapshotExportDialog open={true} onClose={vi.fn()} />);
    const radios = screen.getAllByRole('radio');
    const customRadio = radios[3]; // 4th = Custom
    fireEvent.click(customRadio);
    // Should now show width/height number inputs
    const numberInputs = screen.getAllByRole('spinbutton');
    expect(numberInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('should call onClose when cancel button is clicked', () => {
    const onClose = vi.fn();
    render(<SnapshotExportDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should call onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(<SnapshotExportDialog open={true} onClose={onClose} />);
    const overlay = document.querySelector('.snapshot-overlay');
    if (overlay) {
      fireEvent.click(overlay);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<SnapshotExportDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('should show quality input for JPEG format', () => {
    render(<SnapshotExportDialog open={true} onClose={vi.fn()} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'jpeg' } });
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('should display output size information', () => {
    render(<SnapshotExportDialog open={true} onClose={vi.fn()} />);
    expect(screen.getByText(/Output size.*800.*600/)).toBeInTheDocument();
  });
});
