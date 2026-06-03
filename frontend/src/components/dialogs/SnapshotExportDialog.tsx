/**
 * SnapshotExportDialog — Dialog for configuring and exporting viewport snapshots.
 *
 * Options: export path, format (PNG/JPEG/WebP), background color, transparency,
 * resolution scale. Shows a live preview thumbnail before exporting.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import {
  captureViewportSnapshot,
  downloadBlob,
  generateSnapshotFilename,
  DEFAULT_SNAPSHOT_OPTIONS,
  type SnapshotOptions,
} from '../../viewport/snapshotCapture';
import { getPlatformService } from '../../services';
import './SnapshotExportDialog.css';

export interface SnapshotExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type ScaleOption = 1 | 2 | 4 | 'custom';

/** Get the viewport canvas element from DOM. */
function getViewportCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('.viewport-canvas');
}

/**
 * Open a native save dialog for choosing the export path.
 * Falls back to a generated filename on Web.
 */
async function pickSavePath(defaultFilename: string): Promise<string | null> {
  try {
    const service = await getPlatformService();
    const info = service.getPlatformInfo();
    if (info.type === 'tauri') {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const ext = defaultFilename.split('.').pop() ?? 'png';
      const rawPath = await save({
        defaultPath: defaultFilename,
        filters: [{ name: `Image (*.${ext})`, extensions: [ext] }],
      });
      return rawPath ?? null;
    }
  } catch {
    // Fallback: on web or if dialog is not available
  }
  return null;
}

export function SnapshotExportDialog({ open, onClose }: SnapshotExportDialogProps) {
  const { t } = useTranslation();

  const [format, setFormat] = useState<SnapshotOptions['format']>('png');
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_SNAPSHOT_OPTIONS.backgroundColor);
  const [transparent, setTransparent] = useState(true);
  const [scaleOption, setScaleOption] = useState<ScaleOption>(1);
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [quality, setQuality] = useState(0.92);
  const [exportPath, setExportPath] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const prevUrlRef = useRef<string | null>(null);

  // Generate default filename when format changes
  useEffect(() => {
    if (open && !exportPath) {
      setExportPath(generateSnapshotFilename(format));
    }
  }, [open, format, exportPath]);

  // Compute actual output dimensions
  const canvas = getViewportCanvas();
  const canvasWidth = canvas?.width ?? 1920;
  const canvasHeight = canvas?.height ?? 1080;

  const outputWidth = scaleOption === 'custom' ? customWidth : canvasWidth * scaleOption;
  const outputHeight = scaleOption === 'custom' ? customHeight : canvasHeight * scaleOption;

  // Generate preview when dialog opens or options change
  useEffect(() => {
    if (!open || !canvas) return;

    let cancelled = false;
    const generatePreview = async () => {
      try {
        const scale = scaleOption === 'custom'
          ? Math.min(customWidth / canvasWidth, customHeight / canvasHeight)
          : scaleOption;

        // Generate a small preview (max 400px wide)
        const previewScale = Math.min(400 / canvasWidth, 1) * Math.min(scale, 1);

        const blob = await captureViewportSnapshot(canvas, {
          format: 'png',
          backgroundColor,
          transparent: format === 'jpeg' ? false : transparent,
          scale: previewScale,
          quality: 0.8,
        });

        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        if (prevUrlRef.current) {
          URL.revokeObjectURL(prevUrlRef.current);
        }
        prevUrlRef.current = url;
        setPreviewUrl(url);
      } catch (err) {
        console.error('[Snapshot] Preview generation failed:', err);
      }
    };

    const timer = setTimeout(generatePreview, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, canvas, format, backgroundColor, transparent, scaleOption, customWidth, customHeight, canvasWidth, canvasHeight]);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = null;
      }
    };
  }, []);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setExportPath(generateSnapshotFilename(format));
      setExporting(false);
    }
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleBrowse = useCallback(async () => {
    const defaultName = exportPath || generateSnapshotFilename(format);
    const path = await pickSavePath(defaultName);
    if (path) {
      setExportPath(path);
    }
  }, [exportPath, format]);

  const handleExport = useCallback(async () => {
    if (!canvas) return;
    setExporting(true);
    try {
      const scale = scaleOption === 'custom'
        ? Math.min(customWidth / canvasWidth, customHeight / canvasHeight)
        : scaleOption;

      const blob = await captureViewportSnapshot(canvas, {
        format,
        backgroundColor,
        transparent: format === 'jpeg' ? false : transparent,
        scale,
        quality,
      });

      // Determine filename from exportPath
      const filename = exportPath || generateSnapshotFilename(format);

      // If the path is a full native path (from Tauri save dialog), write directly
      if (filename.includes('/') || filename.includes('\\')) {
        try {
          const { writeFile } = await import('@tauri-apps/plugin-fs');
          const buffer = await blob.arrayBuffer();
          await writeFile(filename, new Uint8Array(buffer));
        } catch {
          // Fallback: download via browser
          downloadBlob(blob, filename.split(/[/\\]/).pop() ?? 'snapshot.png');
        }
      } else {
        downloadBlob(blob, filename);
      }

      onClose();
    } catch (err) {
      console.error('[Snapshot] Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [canvas, format, backgroundColor, transparent, scaleOption, customWidth, customHeight, canvasWidth, canvasHeight, quality, exportPath, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && !exporting) {
      e.stopPropagation();
      void handleExport();
    }
  }, [onClose, handleExport, exporting]);

  if (!open) return null;

  return createPortal(
    <div className="snapshot-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        className="snapshot-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('snapshot.title')}
      >
        <div className="snapshot-header">
          <h2 className="snapshot-title">{t('snapshot.title')}</h2>
          <button className="snapshot-close-btn" onClick={onClose} aria-label={t('common.close')}>
            ×
          </button>
        </div>

        <div className="snapshot-body">
          {/* Export Path */}
          <div className="snapshot-field">
            <label>{t('snapshot.exportPath')}</label>
            <div className="snapshot-path-group">
              <input
                type="text"
                value={exportPath}
                onChange={(e) => setExportPath(e.target.value)}
                placeholder={generateSnapshotFilename(format)}
              />
              <button
                className="snapshot-browse-btn"
                onClick={() => void handleBrowse()}
                title={t('snapshot.browse')}
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </div>

          {/* Format */}
          <div className="snapshot-field">
            <label>{t('snapshot.format')}</label>
            <select
              value={format}
              onChange={(e) => {
                const f = e.target.value as SnapshotOptions['format'];
                setFormat(f);
                // Update path extension
                if (exportPath) {
                  const ext = f === 'jpeg' ? 'jpg' : f;
                  setExportPath(exportPath.replace(/\.\w+$/, `.${ext}`));
                }
              }}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="webp">WebP</option>
            </select>
          </div>

          {/* Background Color */}
          <div className="snapshot-field">
            <label>{t('snapshot.backgroundColor')}</label>
            <div className="snapshot-color-group">
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                disabled={transparent && format !== 'jpeg'}
              />
              <span className="snapshot-color-hex">{backgroundColor}</span>
            </div>
          </div>

          {/* Transparent */}
          <div className="snapshot-field">
            <label>{t('snapshot.transparent')}</label>
            <input
              type="checkbox"
              checked={transparent}
              onChange={(e) => setTransparent(e.target.checked)}
              disabled={format === 'jpeg'}
            />
            {format === 'jpeg' && (
              <span className="snapshot-color-hex">({t('snapshot.jpegNoTransparent')})</span>
            )}
          </div>

          {/* Resolution */}
          <div className="snapshot-field">
            <label>{t('snapshot.resolution')}</label>
            <div className="snapshot-resolution-group">
              {([1, 2, 4] as const).map((s) => (
                <label key={s}>
                  <input
                    type="radio"
                    name="snapshot-scale"
                    checked={scaleOption === s}
                    onChange={() => setScaleOption(s)}
                  />
                  {s}x
                </label>
              ))}
              <label>
                <input
                  type="radio"
                  name="snapshot-scale"
                  checked={scaleOption === 'custom'}
                  onChange={() => setScaleOption('custom')}
                />
                {t('snapshot.custom')}
              </label>
            </div>
          </div>

          {/* Custom size inputs */}
          {scaleOption === 'custom' && (
            <div className="snapshot-custom-size">
              <input
                type="number"
                min={1}
                max={8192}
                value={customWidth}
                onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <span>×</span>
              <input
                type="number"
                min={1}
                max={8192}
                value={customHeight}
                onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1))}
              />
              <span>px</span>
            </div>
          )}

          {/* Quality (JPEG/WebP only) */}
          {format !== 'png' && (
            <div className="snapshot-field">
              <label>{t('snapshot.quality')}</label>
              <input
                type="number"
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(Math.min(1, Math.max(0.1, parseFloat(e.target.value) || 0.92)))}
              />
            </div>
          )}

          {/* Preview */}
          <div className="snapshot-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="Snapshot preview" />
            ) : (
              <span className="snapshot-preview-placeholder">{t('snapshot.generatingPreview')}</span>
            )}
          </div>

          {/* Output info */}
          <div className="snapshot-info">
            {t('snapshot.outputSize')}: {outputWidth} × {outputHeight} px
          </div>
        </div>

        <div className="snapshot-actions">
          <button className="snapshot-btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="snapshot-btn-primary"
            onClick={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? t('snapshot.exporting') : t('snapshot.export')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
