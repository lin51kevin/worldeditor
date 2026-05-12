import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Menu as MenuIcon, ChevronRight,
  FileText, FolderOpen, Save,
  Undo2, Redo2,
  Grid, Crosshair, Magnet, Ruler, RotateCcw,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { MenuItemContrib } from '../stores/pluginContribStore';
import { useBuiltinPluginStore } from '../stores/builtinPluginStore';
import { emitViewportEvent } from '../viewport/viewportEvents';
import { getPlatformService } from '../services';
import { resetAllPanels } from './FloatingPanel';
import { showAlert, showConfirm, showPrompt } from '../utils/dialog';
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
async function showAbout(t: (key: string) => string) {
  const version = '1.8.0430';
  await showAlert(`${t('app.title')}\n\n${t('dialog.version')}: ${version}`, t('dialog.aboutTitle'));
}

// Show version info
async function showVersion(t: (key: string) => string) {
  const version = '1.8.0430';
  const buildDate = '2024-12-12';
  await showAlert(
    `${t('dialog.version')}: ${version}\n${t('dialog.buildDate')}: ${buildDate}`,
    t('dialog.versionTitle'),
  );
}

// Show user manual
async function showUserManual(t: (key: string) => string) {
  await showAlert(t('dialog.userManualContent'), t('dialog.userManualTitle'));
}

// Recent files helpers
const RECENT_FILES_KEY = 'we_recent_files';
const MAX_RECENT = 10;

function loadRecentFiles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveRecentFiles(files: string[]): void {
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files));
}

function pushRecentFile(name: string): string[] {
  const files = loadRecentFiles().filter((f) => f !== name);
  files.unshift(name);
  const trimmed = files.slice(0, MAX_RECENT);
  saveRecentFiles(trimmed);
  return trimmed;
}

// Calculate total road length
function calculateTotalRoadLength(project: Project): number {
  return project.roads.reduce((sum, road) => sum + (road.length || 0), 0);
}

/** Convert a plugin menu contribution to a plain MenuItem. */
function toPluginMenuItem(item: MenuItemContrib, t: (key: string) => string): MenuItem {
  return {
    label: t(item.labelKey),
    shortcut: item.shortcut,
    action: item.onClick,
    disabled: item.isDisabled?.() ?? false,
  };
}

/** Append plugin-contributed items to an existing static menu, with a separator. */
function appendPluginItems(menu: Menu, items: MenuItemContrib[], t: (key: string) => string): Menu {
  if (items.length === 0) return menu;
  return {
    ...menu,
    items: [...menu.items, { separator: true, label: '' }, ...items.map((i) => toPluginMenuItem(i, t))],
  };
}

// Group order for Road menu contributions
const ROAD_GROUP_ORDER = ['', 'transform', 'edit', 'advanced', 'deploy', 'infrastructure', 'junction'];

/**
 * Build Road menu items grouped by their `group` field, with separators between groups.
 * Manual separator items are removed and replaced by group-derived separators.
 */
function buildGroupedRoadItems(
  items: MenuItemContrib[],
  t: (key: string) => string,
): MenuItem[] {
  // Remove manual separator entries
  const realItems = items.filter((item) => !item.separator);

  // Group by group field (undefined → '')
  const groups = new Map<string, MenuItemContrib[]>();
  for (const item of realItems) {
    const g = item.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

  // Sort group keys by predefined order
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ai = ROAD_GROUP_ORDER.indexOf(a);
    const bi = ROAD_GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const result: MenuItem[] = [];
  let firstGroup = true;
  for (const key of sortedKeys) {
    if (!firstGroup) result.push({ separator: true, label: '' });
    firstGroup = false;
    for (const item of groups.get(key)!) {
      result.push({
        label: t(item.labelKey),
        shortcut: item.shortcut,
        action: item.onClick,
        disabled: item.isDisabled?.() ?? false,
      });
    }
  }
  return result;
}

// Create menus based on current state
function buildMenus(
  project: Project,
  isDirty: boolean,
  onNew: () => void,
  onOpen: () => void,
  onSave: () => void,
  onSaveAs: () => void,
  onExit: () => void,
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
  onToggleLeftPanel: () => void,
  onToggleRightPanel: () => void,
  onToggleTemplatePanel: () => void,
  // onToggleOutputPanel: () => void,
  onCalculateRoadLength: () => void,
  onToggleSnap: () => void,
  onMeasureDistance: () => void,
  onMeasureAngle: () => void,
  onMeasureArea: () => void,
  onOpenPluginManager: () => void,
  onOpenSettings: () => void,
  canUndo: boolean,
  canRedo: boolean,
  showGrid: boolean,
  showAxis: boolean,
  snapEnabled: boolean,
  dimension: string,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  templatePanelCollapsed: boolean,
  // outputCollapsed: boolean,
  templatePluginEnabled: boolean,
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
        { label: t('menu.exit'), action: onExit },
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
        { label: t('menu.showLayerPanel'), action: onToggleLeftPanel, checked: !leftCollapsed },
        { label: t('menu.showPropertyPanel'), action: onToggleRightPanel, checked: !rightCollapsed },
        { label: t('menu.showTemplatePanel'), action: onToggleTemplatePanel, checked: !templatePanelCollapsed, disabled: !templatePluginEnabled },
        // { label: t('menu.showOutputPanel'), action: onToggleOutputPanel, checked: !outputCollapsed },
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
      label: t('menu.plugins'),
      items: [
        { label: t('menu.pluginManager'), action: onOpenPluginManager },
        { separator: true, label: '' },
        { label: t('menu.settings'), action: onOpenSettings },
      ],
    },
    {
      label: t('menu.help'),
      items: [
        { label: t('menu.userManual'), action: () => void showUserManual(t) },
        { separator: true, label: '' },
        { label: t('menu.aboutWorldEditor'), action: () => void showAbout(t) },
        { label: t('menu.versionInfo'), action: () => void showVersion(t) },
      ],
    },
  ];
}

interface MenuBarProps {
  onOpenPluginManager?: () => void;
  onOpenSettings?: () => void;
}

export function MenuBar({ onOpenPluginManager = () => {}, onOpenSettings = () => {} }: MenuBarProps) {
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

  const {
    showGrid,
    showAxis,
    toggleGrid,
    toggleAxis,
    setDimension,
    dimension,
    snapEnabled,
    measureMode,
    toggleSnap,
    setMeasureMode,
    layout,
    toggleLeftPanel,
    toggleRightPanel,
    toggleTemplatePanel,
    // toggleOutputPanel,
  } = useEditorViewStore();

  const { theme, toggleTheme } = useThemeStore();
  const { i18n } = useTranslation();
  const allMenuItems = usePluginContribStore((s) => s.menuItems);
  const importers = usePluginContribStore((s) => s.importers);
  const exporters = usePluginContribStore((s) => s.exporters);
  const roadMenuItems = useMemo(
    () => allMenuItems.filter((m) => m.menu === 'road'),
    [allMenuItems],
  );
  const toolsPluginItems = useMemo(
    () => allMenuItems.filter((m) => m.menu === 'tools'),
    [allMenuItems],
  );
  const viewPluginItems = useMemo(
    () => allMenuItems.filter((m) => m.menu === 'view'),
    [allMenuItems],
  );
  const templatePluginEnabled = useBuiltinPluginStore(
    (s) => !s.disabledBuiltins.includes('builtin-templates'),
  );

  const toggleLanguage = useCallback(() => {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
    void i18n.changeLanguage(next);
  }, [i18n]);

  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [hoveredMenu, setHoveredMenu] = useState<number | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>(loadRecentFiles);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // File: New
  const handleNew = useCallback(async () => {
    if (isDirty) {
      if (!await showConfirm(t('dialog.confirmNew'))) return;
    }
    reset();
  }, [isDirty, reset, t]);

  // File: Open
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
      setRecentFiles(pushRecentFile(file.name));
    } catch (err) {
      console.error('[MenuBar] Failed to open file:', err);
      await showAlert(t('dialog.openError'));
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
    const name = await showPrompt(t('dialog.projectName'), project.name);
    if (!name) return;
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    await platform.saveFile(name, xml);
    setProject({ ...project, name });
    useEditorStore.getState().markClean();
  }, [project, setProject, t]);

  // Import OpenDRIVE
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
      setRecentFiles(pushRecentFile(file.name));
    } catch (err) {
      console.error('[MenuBar] Failed to import OpenDRIVE:', err);
      await showAlert(t('dialog.parseError'));
    }
  }, [setProject, t]);

  // Export OpenDRIVE
  const handleExportOpenDrive = useCallback(async () => {
    const platform = await getPlatformService();
    const xml = await platform.writeOpenDrive(project);
    const name = await showPrompt(t('dialog.fileName'), project.name + '.xodr');
    if (!name) return;
    await platform.saveFile(name, xml);
  }, [project, t]);

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
  const handleCalculateRoadLength = useCallback(async () => {
    const total = calculateTotalRoadLength(project);
    await showAlert(
      `${total.toFixed(3)} ${t('dialog.meters')}`,
      t('dialog.roadLengthTitle'),
    );
  }, [project, t]);

  // Reset unsaved changes
  const handleResetToSaved = useCallback(async () => {
    if (!isDirty || !savedProject) return;
    if (!await showConfirm(t('dialog.confirmReset'))) return;
    resetToSaved();
  }, [isDirty, savedProject, resetToSaved, t]);

  // Exit: close the application window
  const handleExit = useCallback(() => {
    window.close();
  }, []);

  const staticMenus = buildMenus(
    project,
    isDirty,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleExit,
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
    toggleLeftPanel,
    toggleRightPanel,
    toggleTemplatePanel,
    // toggleOutputPanel,
    handleCalculateRoadLength,
    toggleSnap,
    () => setMeasureMode('distance'),
    () => setMeasureMode('angle'),
    () => setMeasureMode('area'),
    onOpenPluginManager,
    onOpenSettings,
    canUndo(),
    canRedo(),
    showGrid,
    showAxis,
    snapEnabled,
    dimension,
    layout.leftCollapsed,
    layout.rightCollapsed,
    layout.templatePanelCollapsed,
    // layout.outputCollapsed,
    templatePluginEnabled,
    t,
  );

  // Import menu: OpenDRIVE + all plugin importers (disabled stubs shown greyed out)
  const importMenu: Menu = {
    label: t('menu.import'),
    items: [
      { label: t('menu.importOpenDrive'), action: handleImportOpenDrive },
      ...(importers.length > 0 ? [{ separator: true, label: '' } as MenuItem] : []),
      ...importers.map((imp): MenuItem => ({
        label: `${t('menu.import')} ${imp.formatName}...`,
        disabled: imp.disabled === true,
        action: imp.disabled ? undefined : () => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = imp.extensions.join(',');
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            const content = await file.arrayBuffer();
            const proj = await imp.onImport(content, file.name);
            proj.name = file.name;
            useEditorStore.getState().setProject(proj);
          };
          input.click();
        },
      })),
    ],
  };

  // Export menu: OpenDRIVE + all plugin exporters (disabled stubs shown greyed out)
  const exportMenu: Menu = {
    label: t('menu.export'),
    items: [
      { label: t('menu.exportOpenDrive'), action: handleExportOpenDrive, disabled: project.roads.length === 0 },
      ...(exporters.length > 0 ? [{ separator: true, label: '' } as MenuItem] : []),
      ...exporters.map((exp): MenuItem => ({
        label: `${t('menu.export')} ${exp.formatName}...`,
        disabled: exp.disabled === true,
        action: exp.disabled ? undefined : () => void exp.onExport(project),
      })),
    ],
  };

  // Recent files menu
  const recentFilesMenu: Menu = {
    label: t('menu.recentFiles'),
    items: recentFiles.length === 0
      ? [{ label: t('menu.noRecentFiles'), disabled: true }]
      : [
          ...recentFiles.map((name): MenuItem => ({
            label: name,
            action: handleOpen,
          })),
          { separator: true, label: '' },
          {
            label: t('menu.clearRecentFiles'),
            action: () => { saveRecentFiles([]); setRecentFiles([]); },
          },
        ],
  };

  // Insert plugin-contributed Road menu between Edit (index 1) and View (index 2)
  // Items are grouped by their `group` field with separators between groups.
  const roadMenu = roadMenuItems.length > 0
    ? [{
        label: t('menu.road'),
        items: buildGroupedRoadItems(roadMenuItems, t),
      }]
    : [];

  // Inject plugin-contributed items into View (index 2) and Tools (index 3)
  const viewMenu = appendPluginItems(staticMenus[2]!, viewPluginItems, t);
  const toolsMenu = appendPluginItems(staticMenus[3]!, toolsPluginItems, t);

  const menus = [
    staticMenus[0]!,           // File (with Exit)
    staticMenus[1]!,           // Edit
    importMenu,                // Import top-level menu
    exportMenu,                // Export top-level menu
    recentFilesMenu,           // Recent Files top-level menu
    ...roadMenu,               // Road (dynamic, from plugins)
    viewMenu,                  // View (with plugin items appended)
    toolsMenu,                 // Tools (with plugin items appended)
    staticMenus[4]!,           // Plugins
    staticMenus[5]!,           // Help
  ];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setHoveredMenu(null);
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
      } else if (isCtrl && e.key === 'd') {
        e.preventDefault();
        // Clone road shortcut — delegate to plugin contrib action
        const roadClone = usePluginContribStore.getState().menuItems.find(
          (m) => m.id === 'road-tools:menu-clone',
        );
        if (roadClone && !(roadClone.isDisabled?.() ?? false)) roadClone.onClick();
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
      {/* Left: hamburger menu + quick action buttons */}
      <div className="menubar-left">
        {/* Hamburger menu button */}
        <div className="menubar-item-wrapper">
          <button
            className={`menubar-hamburger ${openMenu !== null ? 'active' : ''}`}
            onClick={() => {
              if (openMenu !== null) {
                setOpenMenu(null);
                setHoveredMenu(null);
              } else {
                setOpenMenu(0);
              }
            }}
            title={t('menu.file')}
          >
            <MenuIcon size={16} />
          </button>
          {openMenu !== null && (
            <div className="menubar-mega-dropdown" onMouseLeave={() => setHoveredMenu(null)}>
              {menus.map((menu, idx) => (
                <div
                  key={menu.label}
                  className={`menubar-mega-item ${hoveredMenu === idx ? 'active' : ''}`}
                  onMouseEnter={() => setHoveredMenu(idx)}
                  onClick={() => setHoveredMenu(hoveredMenu === idx ? null : idx)}
                >
                  <span>{menu.label}</span>
                  <ChevronRight size={14} className="menubar-mega-arrow" />
                  {hoveredMenu === idx && (
                    <div className="menubar-submenu">
                      {menu.items.map((item, i) =>
                        item.separator ? (
                          <div key={i} className="menubar-separator" />
                        ) : (
                          <button
                            key={i}
                            className={`menubar-dropdown-item ${item.disabled ? 'disabled' : ''} ${item.checked ? 'checked' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!item.disabled) {
                                item.action?.();
                                setOpenMenu(null);
                                setHoveredMenu(null);
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
          )}
        </div>

        {/* Separator */}
        <div className="menubar-action-separator" />

        {/* Quick action buttons */}
        <div className="menubar-quick-actions">
          <button className="menubar-action-btn" onClick={handleNew} title={t('toolbar.newTitle')}>
            <FileText size={14} />
          </button>
          <button className="menubar-action-btn" onClick={handleOpen} title={t('toolbar.openTitle')}>
            <FolderOpen size={14} />
          </button>
          <button className="menubar-action-btn" onClick={handleSave} title={t('toolbar.saveTitle')} disabled={!isDirty}>
            <Save size={14} />
          </button>

          <div className="menubar-action-separator" />

          <button className="menubar-action-btn" onClick={undo} title={t('toolbar.undoTitle')} disabled={!canUndo()}>
            <Undo2 size={14} />
          </button>
          <button className="menubar-action-btn" onClick={redo} title={t('toolbar.redoTitle')} disabled={!canRedo()}>
            <Redo2 size={14} />
          </button>
          <button
            className="menubar-action-btn"
            onClick={handleResetToSaved}
            title={t('toolbar.resetTitle')}
            disabled={!isDirty || !savedProject}
          >
            <RotateCcw size={14} />
          </button>

          <div className="menubar-action-separator" />

          {/* View toggles: 3D/2D/Grid/Axis */}
          <button
            className={`menubar-action-btn ${dimension === '3d' ? 'active' : ''}`}
            onClick={handleView3D}
            title={t('toolbar.view3dTitle')}
          >
            <span className="menubar-view-label">3D</span>
          </button>
          <button
            className={`menubar-action-btn ${dimension === '2d' ? 'active' : ''}`}
            onClick={handleView2D}
            title={t('toolbar.view2dTitle')}
          >
            <span className="menubar-view-label">2D</span>
          </button>
          <div className="menubar-action-separator" />
          <button
            className={`menubar-action-btn ${showGrid ? 'active' : ''}`}
            onClick={handleToggleGrid}
            title={t('toolbar.gridTitle')}
          >
            <Grid size={14} />
          </button>
          <button
            className={`menubar-action-btn ${showAxis ? 'active' : ''}`}
            onClick={handleToggleAxis}
            title={t('toolbar.axisTitle')}
          >
            <Crosshair size={14} />
          </button>

          <div className="menubar-action-separator" />

          {/* Snap / Measure */}
          <button
            className={`menubar-action-btn ${snapEnabled ? 'active' : ''}`}
            onClick={toggleSnap}
            title={t('toolbar.snapTitle')}
          >
            <Magnet size={14} />
          </button>
          <button
            className={`menubar-action-btn ${measureMode !== 'none' ? 'active' : ''}`}
            onClick={() => setMeasureMode(measureMode !== 'none' ? 'none' : 'distance')}
            title={t('toolbar.measureTitle')}
          >
            <Ruler size={14} />
          </button>
        </div>
      </div>

      {/* Center: project name */}
      <div className="menubar-center">
        <span className="menubar-project-name">
          <>{project.name}</><>{isDirty ? ' •' : ''}</>
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
