import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MenuBar } from './components/shell/MenuBar';
import { Toolbar } from './components/shell/Toolbar';
import { LayerPanel } from './components/panels/LayerPanel';
import { Viewport } from './components/Viewport';
import { PropertyPanel } from './components/panels/PropertyPanel';
import { TemplatePanel } from './components/panels/TemplatePanel';
import { StatusBar } from './components/shell/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { FloatingPanel } from './components/layout/FloatingPanel';
import { MeasurementPanel } from './components/panels/MeasurementPanel';
import { PluginManager } from './components/dialogs/PluginManager';
import { PluginPanels } from './components/layout/PluginPanel';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { DialogHost } from './components/common/Dialog';
import { WelcomePage } from './components/shell/WelcomePage';
import { ShortcutHelpOverlay } from './components/dialogs/ShortcutHelpOverlay';
import { useProjectStore } from './stores/projectStore';
import { useThemeStore } from './stores/themeStore';
import { useViewportStore } from './stores/viewportStore';
import { useBuiltinPluginStore } from './stores/builtinPluginStore';
import { useRecentFilesStore } from './stores/recentFilesStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { BUILTIN_PLUGINS } from './plugins/builtinRegistry';
import { getPlatformService } from './services';
import { showAlert } from './utils/dialog';
import { emitViewportEvent } from './viewport/viewportEvents';
import { STORAGE_KEYS } from './constants/storage';

const STARTUP_WELCOME_KEY = STORAGE_KEYS.SHOW_WELCOME_ON_STARTUP;

// ── App component ──────────────────────────────────────────────────────────

export function App() {
  const selectedRoadId = useProjectStore((s) => s.selectedRoadId);
  const selectedJunctionId = useProjectStore((s) => s.selectedJunctionId);
  const projectName = useProjectStore((s) => s.project.name);
  const { initTheme } = useThemeStore();
  const { t, i18n } = useTranslation();
  const {
    layout,
    initLayout,
    toggleLeftPanel,
    toggleRightPanel,
    toggleOutputPanel,
    toggleTemplatePanel,
    setEditMode,
    clearSplineKnots,
  } = useViewportStore();
  const { recentFiles, push: pushRecentFile, remove: removeRecentFile } = useRecentFilesStore();
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // showOnStartup: when false, skip welcome page on next launch
  const [showOnStartup, setShowOnStartup] = useState<boolean>(
    () => localStorage.getItem(STARTUP_WELCOME_KEY) !== 'false',
  );
  // isEditorOpen: show editor when:
  //   • startup welcome is disabled (stored 'false'), OR
  //   • the store already has a named project (e.g. set by tests / Tauri deep-link)
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(
    () => localStorage.getItem(STARTUP_WELCOME_KEY) === 'false' ||
          useProjectStore.getState().project.name !== 'Untitled',
  );

  const handleToggleShowOnStartup = useCallback((value: boolean) => {
    setShowOnStartup(value);
    localStorage.setItem(STARTUP_WELCOME_KEY, String(value));
  }, []);

  const disabledBuiltins = useBuiltinPluginStore((s) => s.disabledBuiltins);
  const templatePluginEnabled = !disabledBuiltins.includes('builtin-templates');

  useEffect(() => {
    initTheme();
    initLayout();
  }, [initTheme, initLayout]);

  // Conditionally mount enabled builtin plugins via registry
  useEffect(() => {
    const cleanups = BUILTIN_PLUGINS
      .filter((p) => !disabledBuiltins.includes(p.id))
      .map((p) => p.mount());
    return () => cleanups.forEach((fn) => fn());
  }, [disabledBuiltins]);

  // Auto-collapse the template panel when its plugin is disabled
  useEffect(() => {
    if (!templatePluginEnabled && !layout.templatePanelCollapsed) {
      toggleTemplatePanel();
    }
  }, [templatePluginEnabled, layout.templatePanelCollapsed, toggleTemplatePanel]);

  // Sync native window title and document.title with the current language
  useEffect(() => {
    const title = projectName !== 'Untitled'
      ? `${projectName} — ${t('app.brand', 'WorldEditor')}`
      : t('app.brand', 'WorldEditor');
    document.title = title;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        void getCurrentWindow().setTitle(title);
      }).catch(() => {/* non-critical */});
    }
  }, [t, i18n.language, projectName]);

  // Centralised keyboard shortcuts
  useKeyboardShortcuts({
    toggleLeftPanel,
    toggleRightPanel,
    toggleOutputPanel,
    onShowShortcutHelp: setShowShortcutHelp,
    onSetEditMode: (mode) => {
      // EditModes (move-road, rotate-road): toggle back to default if already active.
      // DrawModes: always enter the mode and reset in-progress knots.
      const isEditMode = mode === 'move-road' || mode === 'rotate-road';
      const current = useViewportStore.getState().editMode;
      if (isEditMode && current === mode) {
        setEditMode('default');
      } else {
        setEditMode(mode);
        if (mode === 'spline') {
          clearSplineKnots();
        }
      }
    },
    onEscape: () => {
      // In draw modes: 1st Escape clears in-progress knots (stays in mode),
      //               2nd Escape (no knots left) returns to default.
      // In all other modes: immediately return to default.
      const drawModes = new Set(['spline']);
      const { editMode: current, splineKnots } = useViewportStore.getState();
      if (drawModes.has(current) && splineKnots.length > 0) {
        clearSplineKnots();
      } else {
        setEditMode('default');
        clearSplineKnots();
      }
    },
    onDeleteSelected: () => useProjectStore.getState().deleteSelected(),
    onZoomToFit: () => emitViewportEvent({ type: 'zoom-to-fit' }),
  });

  // Show right panel only when something is selected (Quick Inspector behavior)
  const showRightPanel = !layout.rightCollapsed && (!!selectedRoadId || !!selectedJunctionId);

  // ── File operations ─────────────────────────────────────────────────────

  const handleOpenFile = useCallback(async () => {
    try {
      const ps = await getPlatformService();
      const result = await ps.openFile();
      if (!result) return;
      const project = await ps.parseOpenDrive(result.content);
      project.name = result.name;
      useProjectStore.getState().setProject(project);
      if (result.path) {
        pushRecentFile(result.name, result.path);
      }
      setIsEditorOpen(true);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [pushRecentFile]);

  /** Create a new empty project and enter the editor. */
  const handleNew = useCallback(() => {
    useProjectStore.getState().reset();
    setIsEditorOpen(true);
  }, []);

  /** Open a recent file by path; fall back to alert + remove if not found. */
  const handleOpenRecent = useCallback(async (recentFile: { name: string; path: string }) => {
    try {
      const ps = await getPlatformService();
      const result = await ps.openFileByPath(recentFile.path);
      if (!result) {
        removeRecentFile(recentFile.path);
        await showAlert(`${t('dialog.fileNotFound')}: ${recentFile.name}`);
        return;
      }
      const project = await ps.parseOpenDrive(result.content);
      project.name = result.name;
      useProjectStore.getState().setProject(project);
      pushRecentFile(result.name, recentFile.path);
      setIsEditorOpen(true);
    } catch {
      removeRecentFile(recentFile.path);
      await showAlert(`${t('dialog.fileNotFound')}: ${recentFile.name}`);
    }
  }, [pushRecentFile, removeRecentFile, t]);

  const handleRemoveRecent = useCallback((path: string) => {
    removeRecentFile(path);
  }, [removeRecentFile]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary t={(key, fallback) => t(key) || fallback || key}>
    {isEditorOpen ? (
      <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
        {/* Full-bleed viewport as base layer */}
        <div className="canvas-viewport">
          <Viewport />
        </div>

        {/* Floating UI layers on top of viewport */}
        <MenuBar
          onOpenPluginManager={() => setShowPluginManager(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenWelcome={() => setIsEditorOpen(false)}
        />
        <Toolbar />

        {/* Floating left panel */}
        {!layout.leftCollapsed && (
          <FloatingPanel
            className="floating-left"
            dragHandleSelector=".panel-header"
            defaultWidth={layout.leftWidth}
            minWidth={180}
            maxWidth={500}
            minHeight={200}
            resizeEdges={['top', 'right', 'bottom', 'left']}
            storageKey="we-panel-left"
            onClose={toggleLeftPanel}
          >
            <LayerPanel />
          </FloatingPanel>
        )}

        {/* Floating template panel — only shown when builtin-templates plugin is enabled */}
        {!layout.templatePanelCollapsed && templatePluginEnabled && (
        <FloatingPanel
          className="floating-template"
          dragHandleSelector=".template-header"
          defaultWidth={layout.leftWidth}
          minWidth={180}
          maxWidth={500}
          minHeight={80}
            resizeEdges={['top', 'right', 'bottom', 'left']}
            storageKey="we-panel-template"
            onClose={toggleTemplatePanel}
        >
          <TemplatePanel />
        </FloatingPanel>
        )}

        {/* Floating right panel — Quick Inspector (only when selected) */}
        {showRightPanel && (
          <FloatingPanel
            className="floating-right"
            dragHandleSelector=".prop-header"
            defaultWidth={layout.rightWidth}
            minWidth={220}
            maxWidth={500}
            minHeight={200}
            resizeEdges={['top', 'right', 'bottom', 'left']}
            anchorHorizontal="right"
            storageKey="we-panel-right"
            onClose={toggleRightPanel}
          >
            <PropertyPanel />
          </FloatingPanel>
        )}

        {/* Floating status chips */}
        <StatusBar />
        <CommandPalette />
        <MeasurementPanel />

        {/* Plugin Manager dialog */}
        <PluginManager open={showPluginManager} onClose={() => setShowPluginManager(false)} />

        {/* Settings dialog */}
        <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

        {/* Plugin-contributed panels */}
        <PluginPanels />

        {/* Keyboard shortcut help overlay */}
        <ShortcutHelpOverlay
          open={showShortcutHelp}
          onClose={() => setShowShortcutHelp(false)}
        />
      </div>
    ) : (
      <WelcomePage
        recentFiles={recentFiles}
        onNew={handleNew}
        onOpenFile={handleOpenFile}
        onOpenRecent={handleOpenRecent}
        onRemoveRecent={handleRemoveRecent}
        showOnStartup={showOnStartup}
        onToggleShowOnStartup={handleToggleShowOnStartup}
      />
    )}
    {/* Themed dialog host — always mounted so dialogs show on WelcomePage too */}
    <DialogHost />
    </ErrorBoundary>
  );
}
