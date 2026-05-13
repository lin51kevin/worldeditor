import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { emitViewportEvent } from '../viewport/viewportEvents';
import { getPlatformService } from '../services';
import { showAlert, showConfirm, showPrompt } from '../utils/dialog';
import { useRecentFilesStore } from '../stores/recentFilesStore';
import type { Project } from '../services/platform';

function calculateTotalRoadLength(project: Project): number {
  return project.roads.reduce((sum, road) => sum + road.length, 0);
}

export function useMenuActions() {
  const project = useEditorStore((s) => s.project);
  const isDirty = useEditorStore((s) => s.isDirty);
  const savedProject = useEditorStore((s) => s.savedProject);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const reset = useEditorStore((s) => s.reset);
  const resetToSaved = useEditorStore((s) => s.resetToSaved);
  const setProject = useEditorStore((s) => s.setProject);

  const { setDimension, toggleGrid, toggleAxis, toggleSnap, setMeasureMode } = useEditorViewStore();
  const { push: pushRecentFile, remove: removeRecentFile } = useRecentFilesStore();
  const { t } = useTranslation();

  const handleNew = useCallback(async () => {
    if (isDirty) {
      if (!await showConfirm(t('dialog.confirmNew'))) return;
    }
    reset();
  }, [isDirty, reset, t]);

  const handleOpen = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const file = await platform.openFile();
      if (!file) return;
      const proj = await platform.parseOpenDrive(file.content);
      if (!proj || !Array.isArray(proj.roads)) {
        await showAlert(t('dialog.parseError'));
        return;
      }
      proj.name = file.name;
      setProject(proj);
      pushRecentFile(file.name, file.path ?? file.name);
    } catch (err) {
      console.error('[MenuBar] Failed to open file:', err);
      await showAlert(t('dialog.openError'));
    }
  }, [setProject, pushRecentFile, t]);

  const handleSave = useCallback(async () => {
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    await platform.saveFile(project.name, xml);
    useEditorStore.getState().markClean();
  }, [project]);

  const handleSaveAs = useCallback(async () => {
    const name = await showPrompt(t('dialog.projectName'), project.name);
    if (!name) return;
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    await platform.saveFile(name, xml);
    setProject({ ...project, name });
    useEditorStore.getState().markClean();
  }, [project, setProject, t]);

  const handleImportOpenDrive = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const file = await platform.openFile();
      if (!file) return;
      const proj = await platform.parseOpenDrive(file.content);
      if (!proj || !Array.isArray(proj.roads)) {
        await showAlert(t('dialog.parseError'));
        return;
      }
      proj.name = file.name;
      setProject(proj);
      pushRecentFile(file.name, file.path ?? file.name);
    } catch (err) {
      console.error('[MenuBar] Failed to import OpenDRIVE:', err);
      await showAlert(t('dialog.parseError'));
    }
  }, [setProject, pushRecentFile, t]);

  const handleOpenRecentFile = useCallback(async (recent: { name: string; path: string }) => {
    try {
      const platform = await getPlatformService();
      const result = await platform.openFileByPath(recent.path);
      if (!result) {
        removeRecentFile(recent.path);
        await showAlert(`${t('dialog.fileNotFound')}: ${recent.name}`);
        return;
      }
      const proj = await platform.parseOpenDrive(result.content);
      if (!proj || !Array.isArray(proj.roads)) {
        await showAlert(t('dialog.parseError'));
        return;
      }
      proj.name = result.name;
      setProject(proj);
      pushRecentFile(result.name, recent.path);
    } catch {
      removeRecentFile(recent.path);
      await showAlert(`${t('dialog.fileNotFound')}: ${recent.name}`);
    }
  }, [setProject, pushRecentFile, removeRecentFile, t]);

  const handleExportOpenDrive = useCallback(async () => {
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    const name = await showPrompt(t('dialog.fileName'), project.name + '.xodr');
    if (!name) return;
    await platform.saveFile(name, xml);
  }, [project, t]);

  const handleDelete = useCallback(() => {
    const { selectedRoadId, removeRoad } = useEditorStore.getState();
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
    const { selectedRoadId, selectedJunctionId } = useEditorStore.getState();
    if (selectedRoadId) {
      emitViewportEvent({ type: 'zoom-to-selected', roadId: selectedRoadId });
    } else if (selectedJunctionId) {
      emitViewportEvent({ type: 'zoom-to-junction', junctionId: selectedJunctionId });
    }
  }, []);

  const handleToggleGrid = useCallback(() => {
    const newVal = !useEditorViewStore.getState().showGrid;
    toggleGrid();
    emitViewportEvent({ type: 'set-show-grid', show: newVal });
  }, [toggleGrid]);

  const handleToggleAxis = useCallback(() => {
    const newVal = !useEditorViewStore.getState().showAxis;
    toggleAxis();
    emitViewportEvent({ type: 'set-show-axis', show: newVal });
  }, [toggleAxis]);

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
    handleImportOpenDrive, handleOpenRecentFile, handleExportOpenDrive,
    handleDelete, handleView3D, handleView2D,
    handleZoomToFit, handleZoomToSelected,
    handleToggleGrid, handleToggleAxis,
    handleCalculateRoadLength, handleResetToSaved, handleExit,
  };
}
