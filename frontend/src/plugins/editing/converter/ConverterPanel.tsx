import { useEffect, useMemo, useState } from 'react';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import './ConverterPanel.css';

interface ConversionLogEntry {
  fileName: string;
  ok: boolean;
  detail: string;
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export default function ConverterPanel() {
  const rawImporters = usePluginContribStore((state) => state.importers);
  const rawExporters = usePluginContribStore((state) => state.exporters);

  const importers = useMemo(
    () => rawImporters.filter((item) => !item.disabled),
    [rawImporters],
  );
  const exporters = useMemo(
    () => rawExporters.filter((item) => !item.disabled),
    [rawExporters],
  );

  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<ConversionLogEntry[]>([]);

  useEffect(() => {
    const firstImporter = importers[0];
    const firstExporter = exporters[0];

    if (!sourceId && firstImporter) {
      setSourceId(firstImporter.id);
    }
    if (!targetId && firstExporter) {
      setTargetId(firstExporter.id);
    }
  }, [exporters, importers, sourceId, targetId]);

  const sourceImporter = useMemo(
    () => importers.find((item) => item.id === sourceId) ?? null,
    [importers, sourceId],
  );
  const targetExporter = useMemo(
    () => exporters.find((item) => item.id === targetId) ?? null,
    [exporters, targetId],
  );

  const convert = async () => {
    if (!sourceImporter || !targetExporter || files.length === 0 || running) {
      return;
    }

    setRunning(true);
    setLogs([]);

    const nextLogs: ConversionLogEntry[] = [];
    for (const file of files) {
      try {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new Error('File exceeds 50 MB limit for in-browser conversion');
        }

        const content = await file.arrayBuffer();
        const project = await sourceImporter.onImport(content, file.name);
        if (!isProjectLike(project)) {
          throw new Error('Importer returned an invalid project');
        }

        const projectName = file.name.replace(/\.[^.]+$/, '');
        await targetExporter.onExport({ ...project, name: projectName });
        nextLogs.push({
          fileName: file.name,
          ok: true,
          detail: `Converted via ${sourceImporter.formatName} → ${targetExporter.formatName}`,
        });
      } catch (error) {
        nextLogs.push({
          fileName: file.name,
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    setLogs(nextLogs);
    setRunning(false);
  };

  return (
    <div className="converter-panel">
      <h3 className="converter-panel__title">Batch Converter</h3>

      <div className="converter-panel__row">
        <label className="converter-panel__field">
          Source Format
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            {importers.map((item) => (
              <option key={item.id} value={item.id}>{item.formatName}</option>
            ))}
          </select>
        </label>

        <label className="converter-panel__field">
          Target Format
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            {exporters.map((item) => (
              <option key={item.id} value={item.id}>{item.formatName}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="converter-panel__field">
        Input Files
        <input
          multiple
          type="file"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>

      <div className="converter-panel__summary">
        {files.length === 0 ? 'No files selected' : `${files.length} file(s) selected`}
      </div>

      <button
        className="converter-panel__button"
        disabled={!sourceImporter || !targetExporter || files.length === 0 || running}
        onClick={() => { void convert(); }}
        type="button"
      >
        {running ? 'Converting…' : 'Convert'}
      </button>

      {logs.length > 0 ? (
        <div className="converter-panel__logs">
          {logs.map((entry) => (
            <div
              key={`${entry.fileName}-${entry.ok ? 'ok' : 'error'}-${entry.detail}`}
              className={`converter-panel__log converter-panel__log--${entry.ok ? 'ok' : 'error'}`}
            >
              <span className="converter-panel__log-name">{entry.fileName}</span>
              <span className="converter-panel__log-detail">{entry.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function isProjectLike(value: unknown): value is { roads: unknown[]; junctions: unknown[]; signals: unknown[]; objects: unknown[] } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.roads)
    && Array.isArray(candidate.junctions)
    && Array.isArray(candidate.signals)
    && Array.isArray(candidate.objects);
}