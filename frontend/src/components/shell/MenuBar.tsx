import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Menu as MenuIcon,
  FileText,
  FolderOpen,
  Save,
  Copy,
  Undo2,
  Redo2,
  Grid,
  Crosshair,
  Magnet,
  Ruler,
  RotateCcw,
  Bot,
  Camera,
  ChevronDown,
  MousePointer,
  SplitSquareHorizontal,
  Route,
  PenLine,
  Box,
  Square,
} from 'lucide-react';
import { usePluginContribStore } from '../../stores/pluginContribStore';
import { useBuiltinPluginStore } from '../../stores/builtinPluginStore';
import { useRecentFilesStore } from '../../stores/recentFilesStore';
import { useViewportStore } from '../../stores/viewportStore';
import { useThemeStore } from '../../stores/themeStore';
import { resetAllPanels } from '../layout/FloatingPanel';
import { useMenuActions } from '../../hooks/useMenuActions';
import {
  checkForUpdates,
  showAbout,
  showUserManual,
  type Menu,
} from './menuDefinitions';
import { EditMenu } from './menus/EditMenu';
import { FileMenu } from './menus/FileMenu';
import { MenuSection } from './menus/MenuSection';
import { ToolsMenu } from './menus/ToolsMenu';
import { ViewMenu } from './menus/ViewMenu';
import { SnapSettingsPanel } from '../panels/SnapSettingsPanel';
import { SelectionModePanel } from '../panels/SelectionModePanel';
import { ViewModePanel } from '../panels/ViewModePanel';
import { SnapshotExportDialog } from '../dialogs/SnapshotExportDialog';
import './MenuBar.css';

export { showVersion } from './menuDefinitions';

interface MenuBarProps {
  onOpenPluginManager?: () => void;
  onOpenSettings?: () => void;
  /** Opens the Welcome page overlay (D2). */
  onOpenWelcome?: () => void;
}

export function MenuBar({
  onOpenPluginManager = () => {},
  onOpenSettings: _onOpenSettings = () => {},
  onOpenWelcome = () => {},
}: MenuBarProps) {
  const {
    project,
    isDirty,
    savedProject,
    undo,
    redo,
    canUndo,
    canRedo,
    toggleSnap,
    setMeasureMode,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleClose,
    handleImportOpenDrive,
    handleImportPointCloud,
    handleOpenRecentFile,
    handleExportOpenDrive,
    handleDelete,
    handleView3D,
    handleView2D,
    handleZoomToFit,
    handleZoomToSelected,
    handleToggleGrid,
    handleToggleAxis,
    handleToggleHoverHighlight,
    handleCalculateRoadLength,
    handleResetToSaved,
    handleExit,
  } = useMenuActions();

  const {
    showGrid,
    showAxis,
    showHoverHighlight,
    dimension,
    snapEnabled,
    measureMode,
    selectionMode,
    viewMode,
    layout,
    toggleLeftPanel,
    toggleRightPanel,
    toggleTemplatePanel,
  } = useViewportStore();

  const { theme, toggleTheme } = useThemeStore();
  const { t, i18n } = useTranslation();
  const allMenuItems = usePluginContribStore((state) => state.menuItems);
  const importers = usePluginContribStore((state) => state.importers);
  const exporters = usePluginContribStore((state) => state.exporters);
  const copilotPanelVisible = usePluginContribStore((state) => state.panelTabVisibility['ai-copilot:panel'] ?? false);
  const toggleCopilotPanel = useCallback(() => {
    usePluginContribStore.getState().togglePanel('ai-copilot:panel');
  }, []);
  const { recentFiles, clear: clearRecentFiles } = useRecentFilesStore();
  const templatePluginEnabled = useBuiltinPluginStore(
    (state) => !state.disabledBuiltins.includes('builtin-templates'),
  );
  const aiCopilotEnabled = useBuiltinPluginStore(
    (state) => !state.disabledBuiltins.includes('ai-copilot'),
  );

  const roadMenuItems = useMemo(
    () => allMenuItems.filter((item) => item.menu === 'road'),
    [allMenuItems],
  );
  const toolsPluginItems = useMemo(
    () => allMenuItems.filter((item) => item.menu === 'tools'),
    [allMenuItems],
  );
  const viewPluginItems = useMemo(
    () => allMenuItems.filter((item) => item.menu === 'view'),
    [allMenuItems],
  );

  const toggleLanguage = useCallback(() => {
    const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
    void i18n.changeLanguage(next);
  }, [i18n]);

  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [hoveredMenu, setHoveredMenu] = useState<number | null>(null);
  const [hoveredSubItem, setHoveredSubItem] = useState<number | null>(null);
  const [snapSettingsOpen, setSnapSettingsOpen] = useState(false);
  const [selectionModeOpen, setSelectionModeOpen] = useState(false);
  const [viewModeOpen, setViewModeOpen] = useState(false);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
    setHoveredMenu(null);
    setHoveredSubItem(null);
    setSnapSettingsOpen(false);
    setSelectionModeOpen(false);
    setViewModeOpen(false);
  }, []);

  const toggleSnapSettings = useCallback(() => {
    setOpenMenu(null);
    setHoveredMenu(null);
    setHoveredSubItem(null);
    setSelectionModeOpen(false);
    setViewModeOpen(false);
    setSnapSettingsOpen((current) => !current);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setOpenMenu(null);
    setHoveredMenu(null);
    setHoveredSubItem(null);
    setSnapSettingsOpen(false);
    setViewModeOpen(false);
    setSelectionModeOpen((current) => !current);
  }, []);

  const toggleViewMode = useCallback(() => {
    setOpenMenu(null);
    setHoveredMenu(null);
    setHoveredSubItem(null);
    setSnapSettingsOpen(false);
    setSelectionModeOpen(false);
    setViewModeOpen((current) => !current);
  }, []);

  const handleButtonMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button')) {
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, []);

  const getMenuSectionProps = (index: number) => ({
    isActive: hoveredMenu === index,
    hoveredSubItem,
    onHover: () => setHoveredMenu(index),
    onToggle: () => {
      setHoveredMenu((current) => (current === index ? null : index));
      setHoveredSubItem(null);
    },
    onSubItemHover: setHoveredSubItem,
    onClose: closeMenus,
  });

  const pluginMenu: Menu = {
    label: t('menu.plugins'),
    items: [{ label: t('menu.pluginManager'), action: onOpenPluginManager }],
  };

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

  useEffect(() => {
    setHoveredSubItem(null);
  }, [hoveredMenu]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(event.target as Node)) {
        closeMenus();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [closeMenus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      const tag = activeElement?.tagName;
      if (activeElement?.closest('.menubar, .toolbar, .road-edit-toolbar') && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        activeElement.blur();
      }
      const isCtrl = event.ctrlKey || event.metaKey;
      if (isCtrl && event.key === 'n') {
        event.preventDefault();
        void handleNew();
      } else if (isCtrl && event.key === 'o') {
        event.preventDefault();
        void handleOpen();
      } else if (isCtrl && event.key === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          void handleSaveAs();
        } else {
          void handleSave();
        }
      } else if (isCtrl && event.key === 'w') {
        event.preventDefault();
        void handleClose();
      } else if (isCtrl && event.key === 'd') {
        event.preventDefault();
        const roadClone = usePluginContribStore.getState().menuItems.find(
          (item) => item.id === 'road-tools:menu-clone',
        );
        if (roadClone && !(roadClone.isDisabled?.() ?? false)) roadClone.onClick();
      } else if (isCtrl && event.key === 'z') {
        // Handled by useKeyboardShortcuts — skip to avoid double undo
      } else if (isCtrl && event.key === 'y') {
        // Handled by useKeyboardShortcuts — skip to avoid double redo
      } else if (event.key === 'Escape') {
        setSnapSettingsOpen(false);
        setSelectionModeOpen(false);
        setViewModeOpen(false);
      } else if (event.key === 'Delete') {
        handleDelete();
      } else if (event.key === 'Home') {
        event.preventDefault();
        handleZoomToFit();
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        handleZoomToSelected();
      } else if (isCtrl && event.altKey && (event.key === 'i' || event.key === 'I')) {
        event.preventDefault();
        toggleCopilotPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleDelete,
    handleNew,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleZoomToFit,
    handleZoomToSelected,
    toggleCopilotPanel,
  ]);

  return (
    <div className="menubar" ref={menuBarRef} onMouseDownCapture={handleButtonMouseDownCapture}>
      <div className="menubar-left">
        <div className="menubar-item-wrapper">
          <button
            className={`menubar-hamburger ${openMenu !== null ? 'active' : ''}`}
            onClick={() => {
              if (openMenu !== null) {
                closeMenus();
              } else {
                setSnapSettingsOpen(false);
                setSelectionModeOpen(false);
                setViewModeOpen(false);
                setOpenMenu(0);
              }
            }}
            title={t('menu.file')}
          >
            <MenuIcon size={16} />
          </button>
          {openMenu !== null && (
            <div
              className="menubar-mega-dropdown"
            >
              <FileMenu
                {...getMenuSectionProps(0)}
                t={t}
                project={project}
                isDirty={isDirty}
                recentFiles={recentFiles}
                importers={importers}
                exporters={exporters}
                clearRecentFiles={clearRecentFiles}
                onNew={handleNew}
                onCloseFile={handleClose}
                onOpen={handleOpen}
                onSave={handleSave}
                onSaveAs={handleSaveAs}
                onExit={handleExit}
                onImportOpenDrive={handleImportOpenDrive}
                onImportPointCloud={handleImportPointCloud}
                onOpenRecentFile={handleOpenRecentFile}
                onExportOpenDrive={handleExportOpenDrive}
              />
              <EditMenu
                {...getMenuSectionProps(1)}
                t={t}
                roadMenuItems={roadMenuItems}
                canUndo={canUndo()}
                canRedo={canRedo()}
                onUndo={undo}
                onRedo={redo}
                onDelete={handleDelete}
              />
              <ViewMenu
                {...getMenuSectionProps(2)}
                t={t}
                viewPluginItems={viewPluginItems}
                dimension={dimension}
                showGrid={showGrid}
                showAxis={showAxis}
                showHoverHighlight={showHoverHighlight}
                leftCollapsed={layout.leftCollapsed}
                rightCollapsed={layout.rightCollapsed}
                templatePanelCollapsed={layout.templatePanelCollapsed}
                templatePluginEnabled={templatePluginEnabled}
                onView3D={handleView3D}
                onView2D={handleView2D}
                onZoomToFit={handleZoomToFit}
                onZoomToSelected={handleZoomToSelected}
                onToggleGrid={handleToggleGrid}
                onToggleAxis={handleToggleAxis}
                onToggleHoverHighlight={handleToggleHoverHighlight}
                onToggleLeftPanel={toggleLeftPanel}
                onToggleRightPanel={toggleRightPanel}
                onToggleTemplatePanel={toggleTemplatePanel}
                onResetPanels={resetAllPanels}
              />
              <ToolsMenu
                {...getMenuSectionProps(3)}
                t={t}
                project={project}
                toolsPluginItems={toolsPluginItems}
                snapEnabled={snapEnabled}
                onCalculateRoadLength={handleCalculateRoadLength}
                onToggleSnap={toggleSnap}
                onMeasureDistance={() => setMeasureMode('distance')}
                onMeasureAngle={() => setMeasureMode('angle')}
                onMeasureArea={() => setMeasureMode('area')}
              />
              <MenuSection menu={pluginMenu} {...getMenuSectionProps(4)} />
              <MenuSection menu={helpMenu} {...getMenuSectionProps(5)} />
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
          <button
            className="menubar-action-btn"
            onClick={() => setSnapshotDialogOpen(true)}
            title={t('toolbar.snapshotTitle')}
          >
            <Camera size={14} />
          </button>

          <div className="menubar-action-separator" />

          <div className="menubar-snap-control">
            <button
              className={`menubar-action-btn ${snapEnabled ? 'active' : ''}`}
              onClick={toggleSnap}
              title={t('toolbar.snapTitle')}
            >
              <Magnet size={14} />
            </button>
            <button
              className={`menubar-action-btn menubar-snap-settings-trigger ${snapSettingsOpen ? 'active' : ''}`}
              onClick={toggleSnapSettings}
              title={t('toolbar.snapSettingsTitle')}
              aria-label={t('toolbar.snapSettingsTitle')}
              aria-haspopup="dialog"
              aria-expanded={snapSettingsOpen}
            >
              <ChevronDown size={12} />
            </button>
            {snapSettingsOpen && <SnapSettingsPanel />}
          </div>
          <button
            className={`menubar-action-btn ${measureMode !== 'none' ? 'active' : ''}`}
            onClick={() => setMeasureMode(measureMode !== 'none' ? 'none' : 'distance')}
            title={t('toolbar.measureTitle')}
          >
            <Ruler size={14} />
          </button>

          <div className="menubar-action-separator" />

          <div className="menubar-snap-control">
            <button
              className={`menubar-action-btn ${selectionModeOpen ? 'active' : ''}`}
              onClick={toggleSelectionMode}
              title={t('toolbar.selectionModeTitle')}
              aria-label={t('toolbar.selectionModeTitle')}
              aria-haspopup="dialog"
              aria-expanded={selectionModeOpen}
            >
              {selectionMode === 'lane' ? <Route size={14} /> : selectionMode === 'laneSection' ? <SplitSquareHorizontal size={14} /> : <MousePointer size={14} />}
            </button>
            <button
              className="menubar-action-btn menubar-snap-settings-trigger"
              onClick={toggleSelectionMode}
              aria-hidden="true"
              tabIndex={-1}
            >
              <ChevronDown size={12} />
            </button>
            {selectionModeOpen && <SelectionModePanel />}
          </div>

          <div className="menubar-snap-control">
            <button
              className={`menubar-action-btn ${viewModeOpen ? 'active' : ''}`}
              onClick={toggleViewMode}
              title={t('toolbar.viewModeTitle')}
              aria-label={t('toolbar.viewModeTitle')}
              aria-haspopup="dialog"
              aria-expanded={viewModeOpen}
            >
              {viewMode === 'sketch' ? <PenLine size={14} /> : viewMode === 'wire' ? <Square size={14} /> : <Box size={14} />}
            </button>
            <button
              className="menubar-action-btn menubar-snap-settings-trigger"
              onClick={toggleViewMode}
              aria-hidden="true"
              tabIndex={-1}
            >
              <ChevronDown size={12} />
            </button>
            {viewModeOpen && <ViewModePanel />}
          </div>
        </div>
      </div>

      <div className="menubar-center">
        <span className="menubar-project-name">
          <>{project.name}</><>{isDirty ? ' •' : ''}</>
        </span>
      </div>

      <div className="menubar-right">
        {aiCopilotEnabled && (
          <button
            className={`menubar-action-btn ${copilotPanelVisible ? 'active' : ''}`}
            onClick={toggleCopilotPanel}
            title={t('toolbar.copilotTitle')}
            aria-label={t('toolbar.copilot')}
          >
            <Bot size={14} />
          </button>
        )}
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
           <span className="menubar-lang-label">
            {theme === 'dark' ? '☀' : '☾'}
          </span>
        </button>
      </div>
      {snapshotDialogOpen && (
        <SnapshotExportDialog
          open={snapshotDialogOpen}
          onClose={() => setSnapshotDialogOpen(false)}
        />
      )}
    </div>
  );
}
