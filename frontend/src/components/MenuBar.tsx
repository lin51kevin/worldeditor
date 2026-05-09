import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import { emitViewportEvent } from '../viewport/viewportEvents';
import { getPlatformService } from '../services';
import { resetAllPanels } from './FloatingPanel';
import type { Project } from '../services/platform';
import './MenuBar.css';

interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  checked?: boolean;
}

interface Menu {
  label: string;
  items: MenuItem[];
}

// Show About dialog
function showAbout(t: (key: string) => string) {
  const version = '1.8.0430';
  alert(`World Editor\n${t('app.title')}\n\n${version}`);
}

// Show version info
function showVersion(t: (key: string) => string) {
  const version = '1.8.0430';
  const buildDate = '2024-12-12';
  alert(`${t('menu.versionInfo')}\n${version}\n${buildDate}`);
}

// Calculate total road length
function calculateTotalRoadLength(project: Project): number {
  return project.roads.reduce((sum, road) => sum + (road.length || 0), 0);
}

// Create menus based on current state
function buildMenus(
  project: Project,
  isDirty: boolean,
  onNew: () => void,
  onOpen: () => void,
  onSave: () => void,
  onSaveAs: () => void,
  onImportOpenDrive: () => void,
  onExportOpenDrive: () => void,
  onUndo: () => void,
  onRedo: () => void,
  onDelete: () => void,
  onView3D: () => void,
  onView2D: () => void,
  onZoomToFit: () => void,
  onZoomToSelected: () => void,
  onToggleGrid: () => void,
  onToggleAxis: () => void,
  onResetPanels: () => void,
  onCalculateRoadLength: () => void,
  onToggleSnap: () => void,
  onMeasureDistance: () => void,
  onMeasureAngle: () => void,
  onMeasureArea: () => void,
  canUndo: boolean,
  canRedo: boolean,
  showGrid: boolean,
  showAxis: boolean,
  snapEnabled: boolean,
  dimension: string,
  t: (key: string) => string,
): Menu[] {
  return [
    {
      label: t('menu.file'),
      items: [
        { label: t('menu.newProject'), shortcut: 'Ctrl+N', action: onNew },
        { label: t('menu.openFile'), shortcut: 'Ctrl+O', action: onOpen },
        { separator: true, label: '' },
        { label: t('menu.save'), shortcut: 'Ctrl+S', action: onSave, disabled: !isDirty },
        { label: t('menu.saveAs'), shortcut: 'Ctrl+Shift+S', action: onSaveAs },
        { separator: true, label: '' },
        { label: t('menu.importOpenDrive'), action: onImportOpenDrive },
        { label: t('menu.exportOpenDrive'), action: onExportOpenDrive, disabled: project.roads.length === 0 },
      ],
    },
    {
      label: t('menu.edit'),
      items: [
        { label: t('menu.undo'), shortcut: 'Ctrl+Z', action: onUndo, disabled: !canUndo },
        { label: t('menu.redo'), shortcut: 'Ctrl+Y', action: onRedo, disabled: !canRedo },
        { separator: true, label: '' },
        { label: t('menu.deleteSelected'), shortcut: 'Del', action: onDelete },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        { label: t('menu.view3D'), action: onView3D, checked: dimension === '3d' },
        { label: t('menu.view2D'), action: onView2D, checked: dimension === '2d' },
        { separator: true, label: '' },
        { label: t('menu.zoomToFit'), shortcut: 'Home', action: onZoomToFit },
        { label: t('menu.zoomToSelected'), shortcut: 'F', action: onZoomToSelected },
        { separator: true, label: '' },
        { label: t('menu.showGrid'), action: onToggleGrid, checked: showGrid },
        { label: t('menu.showAxis'), action: onToggleAxis, checked: showAxis },
        { separator: true, label: '' },
        { label: t('menu.resetPanels'), action: onResetPanels },
      ],
    },
    {
      label: t('menu.tools'),
      items: [
        { label: t('menu.calculateRoadLength'), action: onCalculateRoadLength, disabled: project.roads.length === 0 },
        { separator: true, label: '' },
        { label: t('toolbar.snap'), action: onToggleSnap, checked: snapEnabled },
        { separator: true, label: '' },
        { label: t('measurement.distance'), action: onMeasureDistance },
        { label: t('measurement.angle'), action: onMeasureAngle },
        { label: t('measurement.area'), action: onMeasureArea },
      ],
    },
    {
      label: t('menu.about'),
      items: [
        { label: t('menu.aboutWorldEditor'), action: () => showAbout(t) },
        { label: t('menu.versionInfo'), action: () => showVersion(t) },
      ],
    },
  ];
}

export function MenuBar() {
  const {
    project,
    isDirty,
    undo,
    redo,
    canUndo,
    canRedo,
    reset,
    setProject,
  } = useEditorStore();

  const {
    showGrid,
    showAxis,
    toggleGrid,
    toggleAxis,
    setDimension,
    dimension,
    snapEnabled,
    toggleSnap,
    setMeasureMode,
  } = useEditorViewStore();

  const { theme, toggleTheme } = useThemeStore();
  const { i18n } = useTranslation();

  const toggleLanguage = useCallback(() => {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
    void i18n.changeLanguage(next);
  }, [i18n]);

  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // File: New
  const handleNew = useCallback(() => {
    if (isDirty) {
      if (!window.confirm(t('dialog.confirmNew'))) return;
    }
    reset();
  }, [isDirty, reset]);

  // File: Open
  const handleOpen = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const file = await platform.openFile();
      if (!file) return;
      const proj = await platform.parseOpenDrive(file.content);
      if (!proj || !Array.isArray(proj.roads)) {
        alert(t('dialog.parseError'));
        return;
      }
      proj.name = file.name;
      setProject(proj);
    } catch (err) {
      console.error('[MenuBar] Failed to open file:', err);
      alert(t('dialog.openError'));
    }
  }, [setProject, t]);

  // File: Save
  const handleSave = useCallback(async () => {
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    await platform.saveFile(project.name, xml);
    useEditorStore.getState().markClean();
  }, [project]);

  // File: Save As
  const handleSaveAs = useCallback(async () => {
    const name = window.prompt(t('dialog.projectName'), project.name);
    if (!name) return;
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    await platform.saveFile(name, xml);
    setProject({ ...project, name });
    useEditorStore.getState().markClean();
  }, [project, setProject]);

  // Import OpenDRIVE
  const handleImportOpenDrive = useCallback(async () => {
    try {
      const platform = await getPlatformService();
      const file = await platform.openFile();
      if (!file) return;
      const proj = await platform.parseOpenDrive(file.content);
      if (!proj || !Array.isArray(proj.roads)) {
        alert(t('dialog.parseError'));
        return;
      }
      proj.name = file.name;
      setProject(proj);
    } catch (err) {
      console.error('[MenuBar] Failed to import OpenDRIVE:', err);
      alert(t('dialog.parseError'));
    }
  }, [setProject, t]);

  // Export OpenDRIVE
  const handleExportOpenDrive = useCallback(async () => {
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    const name = window.prompt(t('dialog.fileName'), project.name + '.xodr');
    if (!name) return;
    await platform.saveFile(name, xml);
  }, [project]);

  // Edit: Delete
  const handleDelete = useCallback(() => {
    const { selectedRoadId, removeRoad } = useEditorStore.getState();
    if (selectedRoadId) {
      removeRoad(selectedRoadId);
    }
  }, []);

  // View: 3D
  const handleView3D = useCallback(() => {
    setDimension('3d');
    emitViewportEvent({ type: 'set-dimension', dimension: '3d' });
  }, [setDimension]);

  // View: 2D
  const handleView2D = useCallback(() => {
    setDimension('2d');
    emitViewportEvent({ type: 'set-dimension', dimension: '2d' });
  }, [setDimension]);

  // Zoom to fit
  const handleZoomToFit = useCallback(() => {
    emitViewportEvent({ type: 'zoom-to-fit' });
  }, []);

  // Zoom to selected
  const handleZoomToSelected = useCallback(() => {
    const { selectedRoadId, selectedJunctionId } = useEditorStore.getState();
    if (selectedRoadId) {
      emitViewportEvent({ type: 'zoom-to-selected', roadId: selectedRoadId });
    } else if (selectedJunctionId) {
      emitViewportEvent({ type: 'zoom-to-junction', junctionId: selectedJunctionId });
    }
  }, []);

  // Toggle grid
  const handleToggleGrid = useCallback(() => {
    const newVal = !useEditorViewStore.getState().showGrid;
    toggleGrid();
    emitViewportEvent({ type: 'set-show-grid', show: newVal });
  }, [toggleGrid]);

  // Toggle axis
  const handleToggleAxis = useCallback(() => {
    const newVal = !useEditorViewStore.getState().showAxis;
    toggleAxis();
    emitViewportEvent({ type: 'set-show-axis', show: newVal });
  }, [toggleAxis]);

  // Calculate road length
  const handleCalculateRoadLength = useCallback(() => {
    const total = calculateTotalRoadLength(project);
    alert(`${t('dialog.roadLength')}: ${total.toFixed(3)} ${t('dialog.meters')}`);
  }, [project]);

  const menus = buildMenus(
    project,
    isDirty,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleImportOpenDrive,
    handleExportOpenDrive,
    undo,
    redo,
    handleDelete,
    handleView3D,
    handleView2D,
    handleZoomToFit,
    handleZoomToSelected,
    handleToggleGrid,
    handleToggleAxis,
    resetAllPanels,
    handleCalculateRoadLength,
    toggleSnap,
    () => setMeasureMode('distance'),
    () => setMeasureMode('angle'),
    () => setMeasureMode('area'),
    canUndo(),
    canRedo(),
    showGrid,
    showAxis,
    snapEnabled,
    dimension,
    t,
  );

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && e.key === 'n') {
        e.preventDefault();
        handleNew();
      } else if (isCtrl && e.key === 'o') {
        e.preventDefault();
        handleOpen();
      } else if (isCtrl && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAs();
        } else {
          handleSave();
        }
      } else if (isCtrl && e.key === 'z') {
        e.preventDefault();
        if (canUndo()) undo();
      } else if (isCtrl && e.key === 'y') {
        e.preventDefault();
        if (canRedo()) redo();
      } else if (e.key === 'Delete') {
        handleDelete();
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleZoomToFit();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleZoomToSelected();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNew, handleOpen, handleSave, handleSaveAs, undo, redo, canUndo, canRedo, handleDelete, handleZoomToFit, handleZoomToSelected]);

  return (
    <div className="menubar" ref={menuBarRef}>
      {/* Left: menus */}
      <div className="menubar-left">
        {menus.map((menu, idx) => (
          <div key={menu.label} className="menubar-item-wrapper">
            <button
              className={`menubar-item ${openMenu === idx ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === idx ? null : idx)}
              onMouseEnter={() => {
                if (openMenu !== null) setOpenMenu(idx);
              }}
            >
              {menu.label}
            </button>
            {openMenu === idx && (
              <div className="menubar-dropdown">
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <div key={i} className="menubar-separator" />
                  ) : (
                    <button
                      key={i}
                      className={`menubar-dropdown-item ${item.disabled ? 'disabled' : ''} ${item.checked ? 'checked' : ''}`}
                      onClick={() => {
                        if (!item.disabled) {
                          item.action?.();
                          setOpenMenu(null);
                        }
                      }}
                      disabled={item.disabled}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span className="menubar-shortcut">{item.shortcut}</span>}
                      {item.checked !== undefined && (
                        <span className="menubar-check">{item.checked ? '✓' : ''}</span>
                      )}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Center: project name */}
      <div className="menubar-center">
        <span className="menubar-project-name">
          {project.name}{isDirty ? ' •' : ''}
        </span>
      </div>

      {/* Right: language + theme toggle */}
      <div className="menubar-right">
        <button
          className="menubar-icon-btn"
          onClick={toggleLanguage}
          title={i18n.language.startsWith('zh') ? t('toolbar.switchToEn') : t('toolbar.switchToZh')}
        >
          <span className="menubar-lang-label">
            {i18n.language.startsWith('zh') ? 'EN' : '中'}
          </span>
        </button>
        <button
          className="menubar-icon-btn"
          onClick={toggleTheme}
          title={theme === 'dark' ? t('toolbar.switchToLight') : t('toolbar.switchToDark')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </div>
  );
}
