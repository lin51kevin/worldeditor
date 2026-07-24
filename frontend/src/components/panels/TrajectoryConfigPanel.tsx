/**
 * Trajectory scene configuration panel.
 *
 * Floating, non-modal panel (opened from the playback bar's gear button) for
 * mapping trajectory actors to Gaussian splat `.ply` models:
 *  - pick + recursively scan a data root (classified into scene / road /
 *    trajectory / npc models with thumbnails),
 *  - map the ego (single row) and each opponent (left = actor, right = PLY),
 *  - review / replace / delete configured opponent mappings,
 *  - export / import the whole mapping as a logsim scene descriptor.
 *
 * Actor ids come from the scanned trajectory CSV when available, else from the
 * currently-loaded playback trajectory.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderSearch, Trash2, Plus, Download, Upload, Check } from 'lucide-react';
import { FloatingPanel } from '../layout/FloatingPanel';
import { useTrajectoryStore } from '../../stores/trajectoryStore';
import {
  useTrajectoryConfigStore,
  type LogsimSceneConfig,
} from '../../stores/trajectoryConfigStore';
import { getPlatformService } from '../../services';
import { refreshActorModels, applySceneModel } from '../../viewport/trajectoryPlayback';
import { scanAndClassify, classifyWebFiles } from '../../viewport/trajectorySceneScan';
import { TrajectoryPlyThumbSelect } from './TrajectoryPlyThumbSelect';
import { showAlert } from '../../utils/dialog';
import './TrajectoryConfigPanel.css';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function TrajectoryConfigPanel() {
  const { t } = useTranslation();
  const data = useTrajectoryStore((s) => s.data);

  const configOpen = useTrajectoryConfigStore((s) => s.configOpen);
  const toggleConfigOpen = useTrajectoryConfigStore((s) => s.toggleConfigOpen);
  const plyRoot = useTrajectoryConfigStore((s) => s.plyRoot);
  const scan = useTrajectoryConfigStore((s) => s.scan);
  const scanEntities = useTrajectoryConfigStore((s) => s.scanEntities);
  const actorModels = useTrajectoryConfigStore((s) => s.actorModels);
  const scenePly = useTrajectoryConfigStore((s) => s.scenePly);
  const setPlyRoot = useTrajectoryConfigStore((s) => s.setPlyRoot);
  const setScan = useTrajectoryConfigStore((s) => s.setScan);
  const setScanEntities = useTrajectoryConfigStore((s) => s.setScanEntities);
  const setActorModel = useTrajectoryConfigStore((s) => s.setActorModel);
  const setScenePly = useTrajectoryConfigStore((s) => s.setScenePly);
  const exportConfig = useTrajectoryConfigStore((s) => s.exportConfig);
  const importConfig = useTrajectoryConfigStore((s) => s.importConfig);

  const webInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState<null | 'ego' | 'opp' | 'scene'>(null);
  const [pendingOpponent, setPendingOpponent] = useState('');
  const [pendingPly, setPendingPly] = useState<string | null>(null);

  // Actor ids come from the loaded playback trajectory (the file the user is
  // viewing); fall back to ids parsed from the scanned CSV when nothing is
  // loaded yet.
  const entities = useMemo(() => {
    if (data && data.entities.length > 0) {
      return data.entities.map((e) => ({ id: e.id, ego: e.ego }));
    }
    return scanEntities;
  }, [scanEntities, data]);

  const egoEntity = useMemo(() => entities.find((e) => e.ego) ?? null, [entities]);
  const opponents = useMemo(() => entities.filter((e) => !e.ego), [entities]);
  const mappedOpponents = useMemo(
    () => opponents.filter((e) => e.id in actorModels),
    [opponents, actorModels],
  );
  const unmappedOpponents = useMemo(
    () => opponents.filter((e) => !(e.id in actorModels)),
    [opponents, actorModels],
  );
  const plyCount = scan.npcs.length + scan.scenes.length + scan.roads.length;

  /** Scan + classify a directory (desktop) and store the result. */
  const runScan = useCallback(
    async (dir: string) => {
      setScanning(true);
      try {
        const { scan: result, entities: parsed } = await scanAndClassify(dir);
        setScan(result);
        setScanEntities(parsed);
      } catch (err) {
        console.error('[trajConfig] scan failed:', err);
        void showAlert(String(err), t('dialog.errorTitle', 'Error'));
      } finally {
        setScanning(false);
      }
    },
    [setScan, setScanEntities, t],
  );

  /** Desktop: pick a directory then scan it. */
  const handlePickDirectory = useCallback(async () => {
    const platform = await getPlatformService();
    if (!platform.pickDirectory) return;
    const dir = await platform.pickDirectory();
    if (!dir) return;
    setPlyRoot(dir);
    await runScan(dir);
  }, [setPlyRoot, runScan]);

  /** Web: classify files chosen via a directory picker (browser sandbox). */
  const handleWebFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setScanning(true);
      try {
        const { scan: result, entities: parsed } = await classifyWebFiles(fileList);
        setScan(result);
        setScanEntities(parsed);
        const first = fileList[0] as (File & { webkitRelativePath?: string }) | undefined;
        const rel = first?.webkitRelativePath;
        if (rel) setPlyRoot(rel.split('/')[0] ?? null);
      } finally {
        setScanning(false);
      }
    },
    [setScan, setScanEntities, setPlyRoot],
  );

  const handleScanClick = useCallback(() => {
    if (isTauri()) {
      void handlePickDirectory();
    } else {
      webInputRef.current?.click();
    }
  }, [handlePickDirectory]);

  const handleAddOpponent = useCallback(() => {
    if (!pendingOpponent || !pendingPly) return;
    setActorModel(pendingOpponent, pendingPly);
    setPendingOpponent('');
    setPendingPly(null);
  }, [pendingOpponent, pendingPly, setActorModel]);

  const handleApplyEgo = useCallback(async () => {
    if (!egoEntity) return;
    const egoId = egoEntity.id;
    setApplying('ego');
    try {
      await refreshActorModels((id) => id === egoId);
    } finally {
      setApplying(null);
    }
  }, [egoEntity]);

  const handleApplyOpponents = useCallback(async () => {
    const egoId = egoEntity?.id;
    setApplying('opp');
    try {
      await refreshActorModels((id) => id !== egoId);
    } finally {
      setApplying(null);
    }
  }, [egoEntity]);

  const handleApplyScene = useCallback(async () => {
    setApplying('scene');
    try {
      await applySceneModel();
    } finally {
      setApplying(null);
    }
  }, []);

  const handleExport = useCallback(async () => {
    const config = exportConfig();
    const platform = await getPlatformService();
    await platform.saveFile('scene.logsim.json', JSON.stringify(config, null, 2));
  }, [exportConfig]);

  const handleImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as LogsimSceneConfig;
        if (parsed.version !== 1 || typeof parsed.actorModels !== 'object') {
          throw new Error(t('trajectory.config.invalidFile'));
        }
        importConfig(parsed);
        // Desktop: re-scan the restored root so mapped keys resolve to files.
        if (isTauri() && parsed.plyRoot) await runScan(parsed.plyRoot);
      } catch (err) {
        console.error('[trajConfig] import failed:', err);
        void showAlert(String(err), t('dialog.errorTitle', 'Error'));
      }
    },
    [importConfig, runScan, t],
  );

  if (!configOpen) return null;

  return (
    <FloatingPanel
      className="floating-traj-config"
      dragHandleSelector=".traj-cfg-header"
      defaultWidth={440}
      minWidth={360}
      maxWidth={900}
      minHeight={280}
      resizeEdges={['top', 'right', 'bottom', 'left']}
      storageKey="we-panel-traj-config"
      onClose={() => toggleConfigOpen(false)}
      initialCenter
    >
      <div className="traj-cfg">
        <div className="traj-cfg-header">
          <span>{t('trajectory.config.title')}</span>
        </div>

        <div className="traj-cfg-body">
          {/* ── PLY root directory ── */}
          <section className="traj-cfg-section">
            <h4>{t('trajectory.config.plyRoot')}</h4>
            <div className="traj-cfg-root-row">
              <input
                className="traj-cfg-input"
                type="text"
                readOnly
                value={plyRoot ?? ''}
                placeholder={t('trajectory.config.plyRootPlaceholder')}
                aria-label={t('trajectory.config.plyRoot')}
              />
              <button
                type="button"
                className="traj-cfg-btn"
                onClick={handleScanClick}
                disabled={scanning}
              >
                <FolderSearch size={14} />
                {scanning ? t('trajectory.config.scanning') : t('trajectory.config.scan')}
              </button>
            </div>
            <p className="traj-cfg-hint">
              {t('trajectory.config.foundCount', { n: plyCount })}
            </p>
            <input
              ref={webInputRef}
              type="file"
              className="traj-cfg-hidden"
              // @ts-expect-error non-standard directory picker attribute
              webkitdirectory=""
              multiple
              onChange={(e) => void handleWebFiles(e.target.files)}
            />
          </section>

          {/* ── Ego (single row) ── */}
          <section className="traj-cfg-section">
            <div className="traj-cfg-section-head">
              <h4>{t('trajectory.config.ego')}</h4>
              <button
                type="button"
                className="traj-cfg-apply-btn"
                onClick={() => void handleApplyEgo()}
                disabled={!egoEntity || applying !== null}
              >
                <Check size={13} />
                {applying === 'ego' ? t('trajectory.config.applying') : t('trajectory.config.apply')}
              </button>
            </div>
            {egoEntity ? (
              <div className="traj-cfg-map-row">
                <span className="traj-cfg-actor traj-cfg-actor-ego">{egoEntity.id}</span>
                <span className="traj-cfg-arrow">→</span>
                <TrajectoryPlyThumbSelect
                  value={actorModels[egoEntity.id] ?? null}
                  candidates={scan.npcs}
                  onChange={(key) => setActorModel(egoEntity.id, key)}
                  ariaLabel={t('trajectory.config.egoPly')}
                  noneLabel={t('trajectory.config.none')}
                />
              </div>
            ) : (
              <p className="traj-cfg-empty">{t('trajectory.config.noEgo')}</p>
            )}
          </section>

          {/* ── Opponent block ── */}
          <section className="traj-cfg-section">
            <div className="traj-cfg-section-head">
              <h4>{t('trajectory.config.opponents')}</h4>
              <button
                type="button"
                className="traj-cfg-apply-btn"
                onClick={() => void handleApplyOpponents()}
                disabled={applying !== null}
              >
                <Check size={13} />
                {applying === 'opp' ? t('trajectory.config.applying') : t('trajectory.config.apply')}
              </button>
            </div>

            <div className="traj-cfg-add-row">
              <select
                className="traj-cfg-select traj-cfg-actor-select"
                value={pendingOpponent}
                onChange={(e) => setPendingOpponent(e.target.value)}
                aria-label={t('trajectory.config.selectOpponent')}
              >
                <option value="">{t('trajectory.config.selectOpponent')}</option>
                {unmappedOpponents.map((e) => (
                  <option key={e.id} value={e.id}>{e.id}</option>
                ))}
              </select>
              <span className="traj-cfg-arrow">→</span>
              <TrajectoryPlyThumbSelect
                value={pendingPly}
                candidates={scan.npcs}
                onChange={setPendingPly}
                ariaLabel={t('trajectory.config.selectPly')}
                noneLabel={t('trajectory.config.selectPly')}
              />
              <button
                type="button"
                className="traj-cfg-icon-btn traj-cfg-add-btn"
                onClick={handleAddOpponent}
                disabled={!pendingOpponent || !pendingPly}
                aria-label={t('trajectory.config.add')}
                title={t('trajectory.config.add')}
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="traj-cfg-list">
              {mappedOpponents.length === 0 ? (
                <p className="traj-cfg-empty">{t('trajectory.config.noOpponentMappings')}</p>
              ) : (
                mappedOpponents.map((e) => (
                  <div key={e.id} className="traj-cfg-list-row">
                    <span className="traj-cfg-actor">{e.id}</span>
                    <span className="traj-cfg-arrow">→</span>
                    <TrajectoryPlyThumbSelect
                      value={actorModels[e.id] ?? null}
                      candidates={scan.npcs}
                      onChange={(key) => setActorModel(e.id, key)}
                      ariaLabel={t('trajectory.config.replacePly', { id: e.id })}
                      noneLabel={t('trajectory.config.none')}
                    />
                    <button
                      type="button"
                      className="traj-cfg-icon-btn traj-cfg-del-btn"
                      onClick={() => setActorModel(e.id, null)}
                      aria-label={t('trajectory.config.remove', { id: e.id })}
                      title={t('trajectory.config.remove', { id: e.id })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── Scene & trajectory (optional, for the logsim descriptor) ── */}
          <section className="traj-cfg-section">
            <div className="traj-cfg-section-head">
              <h4>{t('trajectory.config.scene')}</h4>
              <button
                type="button"
                className="traj-cfg-apply-btn"
                onClick={() => void handleApplyScene()}
                disabled={applying !== null}
              >
                <Check size={13} />
                {applying === 'scene' ? t('trajectory.config.applying') : t('trajectory.config.apply')}
              </button>
            </div>
            <div className="traj-cfg-map-row">
              <span className="traj-cfg-actor">{t('trajectory.config.scenePly')}</span>
              <span className="traj-cfg-arrow">→</span>
              <select
                className="traj-cfg-select"
                value={scenePly ?? ''}
                onChange={(e) => setScenePly(e.target.value === '' ? null : e.target.value)}
                aria-label={t('trajectory.config.scenePly')}
              >
                <option value="">{t('trajectory.config.none')}</option>
                {scan.scenes.map((c) => (
                  <option key={c.key} value={c.key}>{c.name}</option>
                ))}
              </select>
            </div>
          </section>
        </div>

        <div className="traj-cfg-footer">
          <button type="button" className="traj-cfg-btn" onClick={() => importInputRef.current?.click()}>
            <Download size={14} />
            {t('trajectory.config.import')}
          </button>
          <button type="button" className="traj-cfg-btn" onClick={() => void handleExport()}>
            <Upload size={14} />
            {t('trajectory.config.export')}
          </button>
          <input
            ref={importInputRef}
            type="file"
            className="traj-cfg-hidden"
            accept=".json,application/json"
            onChange={(e) => void handleImportFile(e.target.files?.[0])}
          />
        </div>
      </div>
    </FloatingPanel>
  );
}
