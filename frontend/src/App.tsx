import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// Eagerly pre-warm WebGPU adapter+device so the viewport mounts faster.
import './viewport/gpuDeviceCache';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MenuBar } from './components/shell/MenuBar';
import { Toolbar } from './components/shell/Toolbar';
import { LayerPanel } from './components/panels/LayerPanel';
import { Viewport } from './components/Viewport';
import { PropertyPanel } from './components/panels/PropertyPanel';
import { TemplatePanel } from './plugins/editing/templates/TemplatePanel';
import { StatusBar } from './components/shell/StatusBar';
import { usePluginContribStore } from './stores/pluginContribStore';
import { FloatingPanel } from './components/layout/FloatingPanel';
import { TrajectoryPlaybackBar } from './components/panels/TrajectoryPlaybackBar';
// ValidationPanel is now rendered via PluginPanels
import { SelectionDetailsPanel } from './components/panels/SelectionDetailsPanel';
import { PluginPanels } from './components/layout/PluginPanel';
import { DialogHost } from './components/common/Dialog';
import { TextContextMenu } from './components/common/TextContextMenu';
import { WelcomePage } from './components/shell/WelcomePage';
import { ShortcutHelpOverlay } from './components/dialogs/ShortcutHelpOverlay';

// ── Code-split non-critical UI ────────────────────────────────────────────
// Heavy dialogs / panels that are opened rarely are lazy-loaded so they stay
// out of the initial bundle and only download when first rendered.
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
);
const MeasurementPanel = lazy(() =>
  import('./components/panels/MeasurementPanel').then((m) => ({ default: m.MeasurementPanel })),
);
const PluginManager = lazy(() =>
  import('./components/dialogs/PluginManager').then((m) => ({ default: m.PluginManager })),
);
const SettingsDialog = lazy(() =>
  import('./components/dialogs/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
);
import { useProjectStore } from './stores/projectStore';
import { useThemeStore } from './stores/themeStore';
import { isDrawMode, useViewportStore } from './stores/viewportStore';
import { useBuiltinPluginStore } from './stores/builtinPluginStore';
import { useRecentFilesStore } from './stores/recentFilesStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { BUILTIN_PLUGINS } from './plugins/builtinRegistry';
import { getPlatformService } from './services';
import { useLoadingProgressStore } from './stores/loadingProgressStore';
import { showAlert } from './utils/dialog';
import { emitViewportEvent } from './viewport/viewportEvents';
import { STORAGE_KEYS } from './constants/storage';
import { useFileLoader } from './hooks/useFileLoader';

const STARTUP_WELCOME_KEY = STORAGE_KEYS.SHOW_WELCOME_ON_STARTUP;

// ── App component ──────────────────────────────────────────────────────────

export function App() {
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
    toggleToolbar,
    setEditMode,
    clearSplineKnots,
    measureMode,
  } = useViewportStore();
  const { recentFiles, push: pushRecentFile, remove: removeRecentFile } = useRecentFilesStore();
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Validation panel visibility is managed by pluginContribStore

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

  // Reveal the native window only AFTER the correct native title-bar theme has been
  // applied and a themed frame has painted. The window is created hidden (see
  // src-tauri/src/lib.rs), so the user never sees the unthemed white flash, nor the
  // title-bar colour switching from dark to light on startup. A backend fallback
  // timer also reveals the window if this effect never runs (e.g. an early error).
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false;
    const saved = localStorage.getItem(STORAGE_KEYS.THEME);
    const theme = saved === 'light' ? 'light' : 'dark';
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        // Apply the native title-bar theme BEFORE the window becomes visible so the
        // user never sees the initial colour flip from dark to light.
        await invoke('set_window_theme', { theme });
        if (cancelled) return;
        // Wait two frames so the webview has painted a themed frame, then reveal.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (cancelled) return;
            void invoke('show_main_window').catch(() => {});
          });
        });
      } catch {
        /* non-critical: backend fallback timer reveals the window */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Conditionally mount enabled builtin plugins via registry
  useEffect(() => {
    const { suspendPanelUpdates } = usePluginContribStore.getState();
    const flush = suspendPanelUpdates();
    const cleanups = BUILTIN_PLUGINS
      .filter((p) => !disabledBuiltins.includes(p.id))
      .map((p) => {
        try {
          return p.mount();
        } catch (err) {
          console.error(`[Plugin] Failed to mount "${p.id}":`, err);
          return () => {};
        }
      });
    flush(); // batch-register all panels in one state update
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
    toggleToolbar,
    toggleValidationPanel: () => {
      const store = usePluginContribStore.getState();
      const vis = store.panelTabVisibility['core:validation'] !== false;
      if (vis) {
        store.hidePanel('core:validation');
      } else {
        store.showPanel('core:validation');
      }
    },
    onShowShortcutHelp: setShowShortcutHelp,
    onSetEditMode: (mode) => {
      // EditModes (move-road, rotate-road, split): toggle back to default if already active.
      // DrawModes: always enter the mode and reset in-progress knots.
      const isEditMode = mode === 'move-road' || mode === 'rotate-road' || mode === 'split' || mode === 'placeSignal' || mode === 'placeObject';
      const current = useViewportStore.getState().editMode;
      if (isEditMode && current === mode) {
        setEditMode('default');
      } else {
        // Leaving one draw mode for another tool: discard any in-progress points.
        if (isDrawMode(current) && current !== mode) {
          clearSplineKnots();
        }
        setEditMode(mode);
        if (isDrawMode(mode)) {
          clearSplineKnots();
        }
      }
    },
    onEscape: () => {
      // In draw modes: 1st Escape clears in-progress knots (stays in mode),
      //               2nd Escape (no knots left) returns to default + clears selection.
      // In all other modes: immediately return to default + clear selection.
      const { editMode: current, splineKnots } = useViewportStore.getState();
      if (isDrawMode(current) && splineKnots.length > 0) {
        clearSplineKnots();
      } else {
        setEditMode('default');
        clearSplineKnots();
        useProjectStore.getState().selectRoad(null);
      }
    },
    onDeleteSelected: () => useProjectStore.getState().deleteSelected(),
    onZoomToFit: () => emitViewportEvent({ type: 'zoom-to-fit' }),
  });



  // ── File operations ─────────────────────────────────────────────────────

  const { loadFile, loadBuffer } = useFileLoader();

  const handleOpenFile = useCallback(async () => {
    try {
      const ps = await getPlatformService();

      // If the platform supports openFilePath() (Tauri), separate the dialog
      // from the file read so we can show the progress overlay while the
      // (potentially several-second) disk read is in progress.
      if (ps.openFilePath) {
        const filePath = await ps.openFilePath();
        if (!filePath) return;

        const name = filePath.split(/[/\\]/).pop() ?? 'untitled';
        const { startLoading, updateProgress, reset } = useLoadingProgressStore.getState();

        // Show progress overlay immediately — user sees feedback right away.
        startLoading(name);
        updateProgress('reading', 5);

        // Double-rAF guarantees one full paint cycle has completed before we
        // continue. Single rAF fires *before* paint; the nested second rAF
        // fires after the browser has composited and displayed the frame.
        // This ensures the "正在读取文件..." overlay is physically visible
        // before the (potentially multi-second) file read IPC starts.
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        let content: string;
        let buffer: ArrayBuffer | undefined;
        try {
          const result = await ps.openFileByPath(filePath);
          if (!result) { reset(); return; }
          content = result.content;
          buffer = result.buffer;
        } catch (err) {
          reset();
          throw err;
        }

        // Mark reading complete and yield another paint frame so the user
        // sees "reading 100%" before the phase switches to "parsing".
        updateProgress('reading', 100);
        await new Promise<void>(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );

        // Parse + mesh. Skip startLoading — we already called it above.
        // Binary files (e.g. .geoz) are routed through the plugin importer.
        const loadResult = buffer
          ? await loadBuffer(buffer, name, { skipStartLoading: true })
          : await loadFile(content, name, { skipStartLoading: true });
        if (loadResult.success) {
          pushRecentFile(name, filePath);
          setIsEditorOpen(true);
        }
        return;
      }

      // Web fallback: openFile() does dialog + read in one shot.
      const result = await ps.openFile();
      if (!result) return;
      const loadResult = result.buffer
        ? await loadBuffer(result.buffer, result.name)
        : await loadFile(result.content, result.name);
      if (loadResult.success) {
        if (result.path) pushRecentFile(result.name, result.path);
        setIsEditorOpen(true);
      }
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [pushRecentFile, loadFile, loadBuffer]);

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
      const loadResult = result.buffer
        ? await loadBuffer(result.buffer, result.name)
        : await loadFile(result.content, result.name);
      if (loadResult.success) {
        pushRecentFile(result.name, recentFile.path);
        setIsEditorOpen(true);
      }
    } catch {
      removeRecentFile(recentFile.path);
      await showAlert(`${t('dialog.fileNotFound')}: ${recentFile.name}`);
    }
  }, [pushRecentFile, removeRecentFile, t, loadFile, loadBuffer]);

  const handleRemoveRecent = useCallback((path: string) => {
    removeRecentFile(path);
  }, [removeRecentFile]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <ErrorBoundary t={(key, fallback) => t(key) || fallback || key}>
    {isEditorOpen ? (
      <div className="app-container" onContextMenu={(e) => {
        // Allow native context menu (with paste) on editable elements
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable
        ) return;
        e.preventDefault();
      }}>
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
        {!layout.toolbarCollapsed && <Toolbar />}

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

        {/* Floating right property panel */}
        {!layout.rightCollapsed && (
          <FloatingPanel
            className="floating-right"
            dragHandleSelector=".prop-header"
            defaultWidth={layout.rightWidth}
            minWidth={220}
            maxWidth={680}
            minHeight={200}
            resizeEdges={['top', 'right', 'bottom', 'left']}
            storageKey="we-panel-right"
            onClose={toggleRightPanel}
          >
            <PropertyPanel />
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



        {/* Floating status chips */}
        <StatusBar />
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        <TrajectoryPlaybackBar />
        {measureMode !== 'none' && (
          <FloatingPanel
            className="floating-measurement"
            dragHandleSelector=".measurement-header"
            defaultWidth={260}
            minWidth={220}
            maxWidth={380}
            minHeight={100}
            resizeEdges={['top', 'right', 'bottom', 'left']}
            storageKey="we-panel-measurement"
          >
            <Suspense fallback={null}>
              <MeasurementPanel />
            </Suspense>
          </FloatingPanel>
        )}

        {/* Selection details overlay — auto-hides when nothing is selected */}
        <SelectionDetailsPanel />



        {/* Plugin Manager dialog */}
        <Suspense fallback={null}>
          {showPluginManager && (
            <PluginManager open={showPluginManager} onClose={() => setShowPluginManager(false)} />
          )}
        </Suspense>

        {/* Settings dialog */}
        <Suspense fallback={null}>
          {showSettings && (
            <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
          )}
        </Suspense>

        {/* Plugin-contributed floating panels */}
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
    {/* Custom text context menu (Cut/Copy/Paste/SelectAll) for inputs and selected text */}
    <TextContextMenu />
    </ErrorBoundary>
  );
}
