import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { Viewport } from './components/Viewport';
import { PropertyPanel } from './components/PropertyPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { FloatingPanel } from './components/FloatingPanel';
import { MeasurementPanel } from './components/MeasurementPanel';
import { PluginManager } from './components/PluginManager';
import { PluginPanels } from './components/PluginPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { DialogHost } from './components/common/Dialog';
import { WelcomePage } from './components/WelcomePage';
import { useEditorStore } from './stores/editorStore';
import { useThemeStore } from './stores/themeStore';
import { useEditorViewStore } from './stores/editorViewStore';
import { useBuiltinPluginStore } from './stores/builtinPluginStore';
import { useRecentFilesStore } from './stores/recentFilesStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { BUILTIN_PLUGINS } from './plugins/builtinRegistry';
import { getPlatformService } from './services';
import { showAlert } from './utils/dialog';

const STARTUP_WELCOME_KEY = 'we-show-welcome-on-startup';

// ── App component ──────────────────────────────────────────────────────────

export function App() {
  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  const selectedJunctionId = useEditorStore((s) => s.selectedJunctionId);
  const projectName = useEditorStore((s) => s.project.name);
  const { initTheme } = useThemeStore();
  const { t, i18n } = useTranslation();
  const {
    layout,
    initLayout,
    toggleLeftPanel,
    toggleRightPanel,
    toggleOutputPanel,
    toggleTemplatePanel,
  } = useEditorViewStore();
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
          useEditorStore.getState().project.name !== 'Untitled',
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
      useEditorStore.getState().setProject(project);
      pushRecentFile(result.name, result.path ?? result.name);
      setIsEditorOpen(true);
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  }, [pushRecentFile]);

  /** Create a new empty project and enter the editor. */
  const handleNew = useCallback(() => {
    useEditorStore.getState().reset();
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
      useEditorStore.getState().setProject(project);
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

        {/* Themed dialog host — renders alert/confirm/prompt dialogs */}
        <DialogHost />

        {/* Keyboard shortcut help overlay */}
        {showShortcutHelp && (
          <div className="shortcut-help-overlay" onClick={() => setShowShortcutHelp(false)}>
            <div className="shortcut-help-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>键盘快捷键</h3>
              <table>
                <tbody>
                  <tr><td><kbd>Ctrl+Z</kbd></td><td>撤销</td></tr>
                  <tr><td><kbd>Ctrl+Y</kbd></td><td>重做</td></tr>
                  <tr><td><kbd>Ctrl+A</kbd></td><td>全选</td></tr>
                  <tr><td><kbd>Ctrl+D</kbd></td><td>复制选中道路</td></tr>
                  <tr><td><kbd>Ctrl+C</kbd></td><td>复制到剪贴板</td></tr>
                  <tr><td><kbd>Ctrl+V</kbd></td><td>粘贴</td></tr>
                  <tr><td><kbd>Delete</kbd></td><td>删除选中</td></tr>
                  <tr><td><kbd>Esc</kbd></td><td>取消选择</td></tr>
                  <tr><td><kbd>E</kbd></td><td>进入几何编辑</td></tr>
                  <tr><td><kbd>Shift+拖拽</kbd></td><td>框选多个元素</td></tr>
                  <tr><td><kbd>Shift+点击</kbd></td><td>切换多选</td></tr>
                  <tr><td><kbd>Home</kbd></td><td>视图缩放到全部</td></tr>
                  <tr><td><kbd>L</kbd></td><td>显示/隐藏图层面板</td></tr>
                  <tr><td><kbd>I</kbd></td><td>显示/隐藏检查面板</td></tr>
                  <tr><td><kbd>?</kbd></td><td>显示此帮助</td></tr>
                </tbody>
              </table>
              <button onClick={() => setShowShortcutHelp(false)}>关闭</button>
            </div>
          </div>
        )}
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
    </ErrorBoundary>
  );
}
