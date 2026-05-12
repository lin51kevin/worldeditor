import { useEffect, useState } from 'react';
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
// import { OutputPanel } from './components/OutputPanel';
import { FloatingPanel } from './components/FloatingPanel';
import { MeasurementPanel } from './components/MeasurementPanel';
import { PluginManager } from './components/PluginManager';
import { PluginPanels } from './components/PluginPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { DialogHost } from './components/common/Dialog';
import { useEditorStore } from './stores/editorStore';
import { useThemeStore } from './stores/themeStore';
import { useEditorViewStore } from './stores/editorViewStore';
import { useBuiltinPluginStore } from './stores/builtinPluginStore';
import { mountRoadToolsPlugin } from './plugins/roadTools.plugin';
import { mountTemplatesPlugin } from './plugins/templates.plugin';
import { mountAdvancedEditingPlugin } from './plugins/advancedEditing.plugin';
import { mountIoCsvPlugin } from './plugins/ioCsv.plugin';
import { mountIoObj3dPlugin } from './plugins/ioObj3d.plugin';
import { mountIoLanelet2Plugin } from './plugins/ioLanelet2.plugin';
import { mountIoShapefilePlugin } from './plugins/ioShapefile.plugin';
import { mountIoDxfPlugin } from './plugins/ioDxf.plugin';
import { mountIoNioPlugin } from './plugins/ioNio.plugin';
import { mountIoMifPlugin } from './plugins/ioMif.plugin';
import { mountIoOsmPlugin } from './plugins/ioOsm.plugin';
import { mountIoSignalsPlugin } from './plugins/ioSignals.plugin';
import { mountIoXodrExtPlugin } from './plugins/ioXodrExt.plugin';
import { mountGisToolsPlugin } from './plugins/gisTools.plugin';
import { mountValidationPlugin } from './plugins/validation.plugin';
import { mountTrafficPlugin } from './plugins/traffic.plugin';
import { mountPointcloudPlugin } from './plugins/pointcloud.plugin';
import { mountSatellitePlugin } from './plugins/satellite.plugin';
import { mountModels3dPlugin } from './plugins/models3d.plugin';
import { mountScriptingPlugin } from './plugins/scripting.plugin';
import { mountEcosystemPlugin } from './plugins/ecosystem.plugin';
import { mountLaneDetectPlugin } from './plugins/laneDetect.plugin';
import { mountConverterPlugin } from './plugins/converter.plugin';

export function App() {
  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  const selectedJunctionId = useEditorStore((s) => s.selectedJunctionId);
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
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showPluginManager, setShowPluginManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const disabledBuiltins = useBuiltinPluginStore((s) => s.disabledBuiltins);
  const templatePluginEnabled = !disabledBuiltins.includes('builtin-templates');

  useEffect(() => {
    initTheme();
    initLayout();
  }, [initTheme, initLayout]);

  // Conditionally mount builtin plugins based on enabled state
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    if (!disabledBuiltins.includes('road-tools')) {
      cleanups.push(mountRoadToolsPlugin());
    }
    if (!disabledBuiltins.includes('builtin-templates')) {
      cleanups.push(mountTemplatesPlugin());
    }
    if (!disabledBuiltins.includes('advanced-editing')) {
      cleanups.push(mountAdvancedEditingPlugin());
    }
    if (!disabledBuiltins.includes('io-csv')) cleanups.push(mountIoCsvPlugin());
    if (!disabledBuiltins.includes('io-obj3d')) cleanups.push(mountIoObj3dPlugin());
    if (!disabledBuiltins.includes('io-lanelet2')) cleanups.push(mountIoLanelet2Plugin());
    if (!disabledBuiltins.includes('io-shapefile')) cleanups.push(mountIoShapefilePlugin());
    if (!disabledBuiltins.includes('io-dxf')) cleanups.push(mountIoDxfPlugin());
    if (!disabledBuiltins.includes('io-nio')) cleanups.push(mountIoNioPlugin());
    if (!disabledBuiltins.includes('io-mif')) cleanups.push(mountIoMifPlugin());
    if (!disabledBuiltins.includes('io-osm')) cleanups.push(mountIoOsmPlugin());
    if (!disabledBuiltins.includes('io-signals')) cleanups.push(mountIoSignalsPlugin());
    if (!disabledBuiltins.includes('io-xodr-ext')) cleanups.push(mountIoXodrExtPlugin());
    if (!disabledBuiltins.includes('gis-tools')) cleanups.push(mountGisToolsPlugin());
    if (!disabledBuiltins.includes('validation')) cleanups.push(mountValidationPlugin());
    if (!disabledBuiltins.includes('traffic')) cleanups.push(mountTrafficPlugin());
    if (!disabledBuiltins.includes('pointcloud')) cleanups.push(mountPointcloudPlugin());
    if (!disabledBuiltins.includes('satellite')) cleanups.push(mountSatellitePlugin());
    if (!disabledBuiltins.includes('3d-models')) cleanups.push(mountModels3dPlugin());
    if (!disabledBuiltins.includes('scripting')) cleanups.push(mountScriptingPlugin());
    if (!disabledBuiltins.includes('ecosystem')) cleanups.push(mountEcosystemPlugin());
    if (!disabledBuiltins.includes('lane-detect')) cleanups.push(mountLaneDetectPlugin());
    if (!disabledBuiltins.includes('converter')) cleanups.push(mountConverterPlugin());
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
    const title = t('app.brand');
    document.title = title;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        void getCurrentWindow().setTitle(title);
      }).catch(() => {/* non-critical */});
    }
  }, [t, i18n.language]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const { canUndo, undo } = useEditorStore.getState();
        if (canUndo()) undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const { canRedo, redo } = useEditorStore.getState();
        if (canRedo()) redo();
      }
      // Ctrl+B: toggle left panel
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggleLeftPanel();
      }
      // L: toggle layer panel (Scheme B shortcut)
      if (e.key === 'l' || e.key === 'L') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (target.closest('.cp-overlay, .menubar-dropdown, [role="dialog"], dialog')) return;
        e.preventDefault();
        toggleLeftPanel();
      }
      // I: toggle inspector/right panel
      if (e.key === 'i' || e.key === 'I') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (target.closest('.cp-overlay, .menubar-dropdown, [role="dialog"], dialog')) return;
        e.preventDefault();
        toggleRightPanel();
      }
      // Ctrl+J: toggle output panel
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        toggleOutputPanel();
      }
      // Ctrl+A: select all roads and junctions
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        useEditorStore.getState().selectAll();
      }
      // Ctrl+C: copy selected road to clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        useEditorStore.getState().copySelected();
      }
      // Ctrl+V: paste road from clipboard
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        useEditorStore.getState().pasteFromClipboard();
      }
      // ?: toggle shortcut help overlay (no modifier, not in input)
      if (e.key === '?') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        setShowShortcutHelp((v) => !v);
      }
      // Escape: close shortcut help overlay (if open)
      if (e.key === 'Escape') {
        setShowShortcutHelp(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftPanel, toggleRightPanel, toggleOutputPanel]);

  // Show right panel only when something is selected (Quick Inspector behavior)
  const showRightPanel = !layout.rightCollapsed && (!!selectedRoadId || !!selectedJunctionId);

  return (
    <ErrorBoundary t={(key, fallback) => t(key) || fallback || key}>
    <div className="app-container" onContextMenu={(e) => e.preventDefault()}>
      {/* Full-bleed viewport as base layer */}
      <div className="canvas-viewport">
        <Viewport />
      </div>

      {/* Floating UI layers on top of viewport */}
      <MenuBar onOpenPluginManager={() => setShowPluginManager(true)} onOpenSettings={() => setShowSettings(true)} />
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

      {/* Floating output panel */}
      {/* {!layout.outputCollapsed && (
        <div className="floating-output">
          <OutputPanel />
        </div>
      )} */}

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
    </ErrorBoundary>
  );
}
