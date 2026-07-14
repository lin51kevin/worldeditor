import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';
import { emitViewportEvent } from '../viewport/viewportEvents';
import { getPlatformService } from '../services';
import { showAlert, showConfirm, showPrompt } from '../utils/dialog';
import { useRecentFilesStore } from '../stores/recentFilesStore';
import type { Project } from '../services/platform';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { useFileLoader } from './useFileLoader';
import { promptImportTrajectory, stopTrajectory } from '../viewport/trajectoryPlayback';

function calculateTotalRoadLength(project: Project): number {
  return project.roads.reduce((sum, road) => sum + road.length, 0);
}

export function useMenuActions() {
  const project = useProjectStore((s) => s.project);
  const isDirty = useProjectStore((s) => s.isDirty);
  const savedProject = useProjectStore((s) => s.savedProject);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const reset = useProjectStore((s) => s.reset);
  const resetToSaved = useProjectStore((s) => s.resetToSaved);
  const setProject = useProjectStore((s) => s.setProject);

  const { setDimension, toggleGrid, toggleAxis, toggleHoverHighlight, toggleSnap, setMeasureMode } = useViewportStore();
  const { push: pushRecentFile, remove: removeRecentFile } = useRecentFilesStore();
  const { t } = useTranslation();
  const { loadFile, loadBuffer } = useFileLoader();

  const handleNew = useCallback(async () => {
    if (isDirty) {
      if (!await showConfirm(t('dialog.confirmNew'))) return;
    }
    stopTrajectory();
    reset();
  }, [isDirty, reset, t]);

  const handleOpen = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const file = await platform.openFile();
      if (!file) return;

      // Binary files (.geoz) are handled via the plugin importer system
      if (file.buffer) {
        const { importers } = usePluginContribStore.getState();
        const lower = file.name.toLowerCase();
        const importer = importers.find(
          (imp) => !imp.disabled && imp.extensions.some((ext) => lower.endsWith(ext)),
        );
        if (!importer) {
          await showAlert(t('dialog.parseError'));
          return;
        }
        const project = await importer.onImport(file.buffer, file.name);
        project.name = file.name;
        useProjectStore.getState().setProject(project);
        if (file.path) {
          pushRecentFile(file.name, file.path);
        }
        return;
      }

      const result = await loadFile(file.content, file.name);
      if (!result.success) {
        await showAlert(t('dialog.parseError'));
        return;
      }
      if (file.path) {
        pushRecentFile(file.name, file.path);
      }
    } catch (err) {
      console.error('[MenuBar] Failed to open file:', err);
      const detail = err instanceof Error ? err.message : String(err);
      await showAlert(`${t('dialog.openError')}\n\n${detail}`);
    }
  }, [loadFile, pushRecentFile, t]);

  const handleSave = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const xml = await platform.writeOpenDrive(project);
      const savedPath = await platform.saveFile(project.name, xml);
      if (!savedPath) return;
      useProjectStore.getState().markClean();
    } catch (err) {
      console.error('[MenuBar] Failed to save file:', err);
      await showAlert(t('dialog.saveError'));
    }
  }, [project, t]);

  const handleSaveAs = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const xml = await platform.writeOpenDrive(project);
      const savedPath = await platform.saveFile(project.name, xml);
      if (!savedPath) return; // user cancelled the dialog
      // Extract bare filename (without path separators) to use as project name
      const bare = savedPath.replace(/\\/g, '/').split('/').pop() ?? savedPath;
      setProject({ ...project, name: bare });
      useProjectStore.getState().markClean();
    } catch (err) {
      console.error('[MenuBar] Failed to save file as:', err);
      await showAlert(t('dialog.saveError'));
    }
  }, [project, setProject, t]);

  const handleImportOpenDrive = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const file = await platform.openFile();
      if (!file) return;
      const result = await loadFile(file.content, file.name);
      if (!result.success) {
        await showAlert(t('dialog.parseError'));
        return;
      }
      if (file.path) {
        pushRecentFile(file.name, file.path);
      }
    } catch (err) {
      console.error('[MenuBar] Failed to import OpenDRIVE:', err);
      await showAlert(t('dialog.parseError'));
    }
  }, [loadFile, pushRecentFile, t]);

  const handleImportPointCloud = useCallback(() => {
    const { showPanel } = usePluginContribStore.getState();
    showPanel('pointcloud-beta:panel');
  }, []);

  const handleImportTrajectory = useCallback(() => {
    promptImportTrajectory();
  }, []);

  const handleOpenRecentFile = useCallback(async (recent: { name: string; path: string }) => {
    try {
      const platform = await getPlatformService();
      const fileResult = await platform.openFileByPath(recent.path);
      if (!fileResult) {
        removeRecentFile(recent.path);
        await showAlert(`${t('dialog.fileNotFound')}: ${recent.name}`);
        return;
      }
      // Binary files (e.g. .geoz) are routed through the plugin importer; the
      // XML text path would receive an empty string and silently produce an
      // empty project.
      const result = fileResult.buffer
        ? await loadBuffer(fileResult.buffer, fileResult.name)
        : await loadFile(fileResult.content, fileResult.name);
      if (!result.success) {
        await showAlert(t('dialog.parseError'));
        return;
      }
      pushRecentFile(fileResult.name, recent.path);
    } catch {
      removeRecentFile(recent.path);
      await showAlert(`${t('dialog.fileNotFound')}: ${recent.name}`);
    }
  }, [loadFile, loadBuffer, pushRecentFile, removeRecentFile, t]);

  const handleExportOpenDrive = useCallback(async () => {
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    const name = await showPrompt(t('dialog.fileName'), project.name + '.xodr');
    if (!name) return;
    await platform.saveFile(name, xml);
  }, [project, t]);

  const handleDelete = useCallback(() => {
    const { selectedRoadId, removeRoad } = useProjectStore.getState();
    if (selectedRoadId) {
      removeRoad(selectedRoadId);
    }
  }, []);

  const handleView3D = useCallback(() => {
    setDimension('3d');
    emitViewportEvent({ type: 'set-dimension', dimension: '3d' });
  }, [setDimension]);

  const handleView2D = useCallback(() => {
    setDimension('2d');
    emitViewportEvent({ type: 'set-dimension', dimension: '2d' });
  }, [setDimension]);

  const handleZoomToFit = useCallback(() => {
    emitViewportEvent({ type: 'zoom-to-fit' });
  }, []);

  const handleZoomToSelected = useCallback(() => {
    const { selectedRoadId, selectedJunctionId } = useProjectStore.getState();
    if (selectedRoadId) {
      emitViewportEvent({ type: 'zoom-to-selected', roadId: selectedRoadId });
    } else if (selectedJunctionId) {
      emitViewportEvent({ type: 'zoom-to-junction', junctionId: selectedJunctionId });
    }
  }, []);

  const handleToggleGrid = useCallback(() => {
    const newVal = !useViewportStore.getState().showGrid;
    toggleGrid();
    emitViewportEvent({ type: 'set-show-grid', show: newVal });
  }, [toggleGrid]);

  const handleToggleAxis = useCallback(() => {
    const newVal = !useViewportStore.getState().showAxis;
    toggleAxis();
    emitViewportEvent({ type: 'set-show-axis', show: newVal });
  }, [toggleAxis]);

  const handleToggleHoverHighlight = useCallback(() => {
    toggleHoverHighlight();
  }, [toggleHoverHighlight]);

  const handleCalculateRoadLength = useCallback(async () => {
    const total = calculateTotalRoadLength(project);
    await showAlert(
      `${total.toFixed(3)} ${t('dialog.meters')}`,
      t('dialog.roadLengthTitle'),
    );
  }, [project, t]);

  const handleResetToSaved = useCallback(async () => {
    if (!isDirty || !savedProject) return;
    if (!await showConfirm(t('dialog.confirmReset'))) return;
    resetToSaved();
  }, [isDirty, savedProject, resetToSaved, t]);

  const handleClose = useCallback(async () => {
    if (isDirty) {
      if (!await showConfirm(t('dialog.confirmClose'))) return;
    }
    stopTrajectory();
    reset();
  }, [isDirty, reset, t]);

  const handleExit = useCallback(async () => {
    if (isDirty) {
      const confirmed = await showConfirm(t('dialog.exitUnsaved'));
      if (!confirmed) return;
    }
    window.close();
  }, [isDirty, t]);

  return {
    project, isDirty, savedProject,
    undo, redo, canUndo, canRedo,
    toggleSnap, setMeasureMode,
    handleNew, handleOpen, handleSave, handleSaveAs,
    handleClose, handleImportOpenDrive, handleImportPointCloud, handleImportTrajectory, handleOpenRecentFile, handleExportOpenDrive,
    handleDelete, handleView3D, handleView2D,
    handleZoomToFit, handleZoomToSelected,
    handleToggleGrid, handleToggleAxis, handleToggleHoverHighlight,
    handleCalculateRoadLength, handleResetToSaved, handleExit,
  };
}
