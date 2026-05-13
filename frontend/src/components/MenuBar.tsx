import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Menu as MenuIcon, ChevronRight,
  FileText, FolderOpen, Save, Copy,
  Undo2, Redo2,
  Grid, Crosshair, Magnet, Ruler, RotateCcw,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { useEditorViewStore } from '../stores/editorViewStore';
import { useThemeStore } from '../stores/themeStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { MenuItemContrib } from '../stores/pluginContribStore';
import { useBuiltinPluginStore } from '../stores/builtinPluginStore';
import { useRecentFilesStore } from '../stores/recentFilesStore';
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
  submenu?: MenuItem[];
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
export async function showVersion(t: (key: string) => string) {
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

async function checkForUpdates(t: (key: string) => string) {
  // TODO: [Phase D4] Implement real version check via GitHub Releases API
  await showAlert('Update check: coming in a future version.', t('menu.checkForUpdates'));
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

function appendRoadItemsToEdit(menu: Menu, items: MenuItemContrib[], t: (key: string) => string): Menu {
  if (items.length === 0) return menu;
  return {
    ...menu,
    items: [...menu.items, { separator: true, label: '' }, ...buildGroupedRoadItems(items, t)],
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
  const realItems = items.filter((item) => !item.separator);

  const groups = new Map<string, MenuItemContrib[]>();
  for (const item of realItems) {
    const g = item.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(item);
  }

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
  onCalculateRoadLength: () => void,
  onToggleSnap: () => void,
  onMeasureDistance: () => void,
  onMeasureAngle: () => void,
  onMeasureArea: () => void,
  onOpenPluginManager: () => void,
  _onOpenSettings: () => void,
  canUndo: boolean,
  canRedo: boolean,
  showGrid: boolean,
  showAxis: boolean,
  snapEnabled: boolean,
  dimension: string,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  templatePanelCollapsed: boolean,
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
      ],
    },
    {
      label: t('menu.help'),
      items: [
        { label: t('menu.userManual'), action: () => void showUserManual(t) },
        { label: t('menu.checkForUpdates'), action: () => void checkForUpdates(t) },
        { separator: true, label: '' },
        { label: t('menu.aboutWorldEditor'), action: () => void showAbout(t) },
      ],
    },
  ];
}

interface MenuBarProps {
  onOpenPluginManager?: () => void;
  onOpenSettings?: () => void;
  /** Opens the Welcome page overlay (D2). */
  onOpenWelcome?: () => void;
}

export function MenuBar({ onOpenPluginManager = () => {}, onOpenSettings: _onOpenSettings = () => {}, onOpenWelcome = () => {} }: MenuBarProps) {
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
  const [hoveredSubItem, setHoveredSubItem] = useState<number | null>(null);
  const { recentFiles, push: pushRecentFile, remove: removeRecentFile, clear: clearRecentFiles } = useRecentFilesStore();
  const menuBarRef = useRef<HTMLDivElement>(null);
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

  const staticMenus = buildMenus(
    project,
    isDirty,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    () => { void handleExit(); },
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
    handleCalculateRoadLength,
    toggleSnap,
    () => setMeasureMode('distance'),
    () => setMeasureMode('angle'),
    () => setMeasureMode('area'),
    onOpenPluginManager,
    _onOpenSettings,
    canUndo(),
    canRedo(),
    showGrid,
    showAxis,
    snapEnabled,
    dimension,
    layout.leftCollapsed,
    layout.rightCollapsed,
    layout.templatePanelCollapsed,
    templatePluginEnabled,
    t,
  );

  const recentSubmenu: MenuItem[] = recentFiles.length === 0
    ? [{ label: t('menu.noRecentFiles'), disabled: true }]
    : [
        ...recentFiles.map((f): MenuItem => ({
          label: f.name,
          action: () => { void handleOpenRecentFile(f); },
        })),
        { separator: true, label: '' },
        { label: t('menu.clearRecentFiles'), action: clearRecentFiles },
      ];

  const importSubmenu: MenuItem[] = [
    { label: t('menu.importOpenDrive'), action: handleImportOpenDrive },
    ...importers.filter((imp) => !imp.disabled).map((imp): MenuItem => ({
      label: `${t('menu.import')} ${imp.formatName}...`,
      action: () => {
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
  ];

  const exportSubmenu: MenuItem[] = [
    { label: t('menu.exportOpenDrive'), action: handleExportOpenDrive, disabled: project.roads.length === 0 },
    ...exporters.filter((exp) => !exp.disabled).map((exp): MenuItem => ({
      label: `${t('menu.export')} ${exp.formatName}...`,
      action: () => { void exp.onExport(project); },
    })),
  ];

  const fileMenu: Menu = {
    label: t('menu.file'),
    items: [
      { label: t('menu.newProject'), shortcut: 'Ctrl+N', action: handleNew },
      { label: t('menu.openFile'), shortcut: 'Ctrl+O', action: handleOpen },
      { label: t('menu.openRecentFiles'), submenu: recentSubmenu },
      { separator: true, label: '' },
      { label: t('menu.import'), submenu: importSubmenu },
      { label: t('menu.export'), submenu: exportSubmenu },
      { separator: true, label: '' },
      { label: t('menu.save'), shortcut: 'Ctrl+S', action: handleSave, disabled: !isDirty },
      { label: t('menu.saveAs'), shortcut: 'Ctrl+Shift+S', action: handleSaveAs },
      { separator: true, label: '' },
      { label: t('menu.exit'), action: () => { void handleExit(); } },
    ],
  };

  const editMenu = appendRoadItemsToEdit(staticMenus[1]!, roadMenuItems, t);
  const viewMenu = appendPluginItems(staticMenus[2]!, viewPluginItems, t);
  const toolsMenu = appendPluginItems(staticMenus[3]!, toolsPluginItems, t);

  // D2: build Help menu inline to inject "欢迎" item at top
  const helpMenu: Menu = {
    label: t('menu.help'),
    items: [
      { label: t('menu.welcome'), action: onOpenWelcome },
      { separator: true, label: '' },
      { label: t('menu.userManual'), action: () => void showUserManual(t) },
      { label: t('menu.checkForUpdates'), action: () => void checkForUpdates(t) },
      { separator: true, label: '' },
      { label: t('menu.aboutWorldEditor'), action: () => void showAbout(t) },
    ],
  };

  const menus = [
    fileMenu,
    editMenu,
    viewMenu,
    toolsMenu,
    staticMenus[4]!,
    helpMenu,
  ];

  useEffect(() => {
    setHoveredSubItem(null);
  }, [hoveredMenu]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setHoveredMenu(null);
        setHoveredSubItem(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl && e.key === 'n') {
        e.preventDefault();
        void handleNew();
      } else if (isCtrl && e.key === 'o') {
        e.preventDefault();
        void handleOpen();
      } else if (isCtrl && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          void handleSaveAs();
        } else {
          void handleSave();
        }
      } else if (isCtrl && e.key === 'd') {
        e.preventDefault();
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
      <div className="menubar-left">
        <div className="menubar-item-wrapper">
          <button
            className={`menubar-hamburger ${openMenu !== null ? 'active' : ''}`}
            onClick={() => {
              if (openMenu !== null) {
                setOpenMenu(null);
                setHoveredMenu(null);
                setHoveredSubItem(null);
              } else {
                setOpenMenu(0);
              }
            }}
            title={t('menu.file')}
          >
            <MenuIcon size={16} />
          </button>
          {openMenu !== null && (
            <div className="menubar-mega-dropdown" onMouseLeave={() => { setHoveredMenu(null); setHoveredSubItem(null); }}>
              {menus.map((menu, idx) => (
                <div
                  key={menu.label}
                  className={`menubar-mega-item ${hoveredMenu === idx ? 'active' : ''}`}
                  onMouseEnter={() => setHoveredMenu(idx)}
                  onClick={() => { setHoveredMenu(hoveredMenu === idx ? null : idx); setHoveredSubItem(null); }}
                >
                  <span>{menu.label}</span>
                  <ChevronRight size={14} className="menubar-mega-arrow" />
                  {hoveredMenu === idx && (
                    <div className="menubar-submenu">
                      {menu.items.map((item, i) =>
                        item.separator ? (
                          <div key={i} className="menubar-separator" />
                        ) : item.submenu ? (
                          <div
                            key={i}
                            className={`menubar-dropdown-item menubar-has-sub ${hoveredSubItem === i ? 'sub-active' : ''}`}
                            onMouseEnter={() => setHoveredSubItem(i)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setHoveredSubItem(hoveredSubItem === i ? null : i);
                            }}
                          >
                            <span>{item.label}</span>
                            <ChevronRight size={10} className="menubar-sub-arrow" />
                            {hoveredSubItem === i && (
                              <div className="menubar-flyout">
                                {item.submenu.map((sub, j) =>
                                  sub.separator ? (
                                    <div key={j} className="menubar-separator" />
                                  ) : (
                                    <button
                                      key={j}
                                      className={`menubar-dropdown-item ${sub.disabled ? 'disabled' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!sub.disabled && sub.action) {
                                          sub.action();
                                          setOpenMenu(null);
                                          setHoveredMenu(null);
                                          setHoveredSubItem(null);
                                        }
                                      }}
                                      disabled={sub.disabled}
                                    >
                                      <span>{sub.label}</span>
                                      {sub.shortcut && <span className="menubar-shortcut">{sub.shortcut}</span>}
                                    </button>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
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
                                setHoveredSubItem(null);
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

        <div className="menubar-action-separator" />

        <div className="menubar-quick-actions">
          <button className="menubar-action-btn" onClick={() => { void handleNew(); }} title={t('toolbar.newTitle')}>
            <FileText size={14} />
          </button>
          <button className="menubar-action-btn" onClick={() => { void handleOpen(); }} title={t('toolbar.openTitle')}>
            <FolderOpen size={14} />
          </button>
          <button className="menubar-action-btn" onClick={() => { void handleSave(); }} title={t('toolbar.saveTitle')} disabled={!isDirty}>
            <Save size={14} />
          </button>
          <button
            className="menubar-action-btn"
            onClick={() => { void handleSaveAs(); }}
            title={t('toolbar.saveAsTitle')}
          >
            <Copy size={14} />
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
            onClick={() => { void handleResetToSaved(); }}
            title={t('toolbar.resetTitle')}
            disabled={!isDirty || !savedProject}
          >
            <RotateCcw size={14} />
          </button>

          <div className="menubar-action-separator" />

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

      <div className="menubar-center">
        <span className="menubar-project-name">
          <>{project.name}</><>{isDirty ? ' •' : ''}</>
        </span>
      </div>

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
