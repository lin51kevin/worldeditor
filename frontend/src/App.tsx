import { useEffect } from 'react';
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
import { OutputPanel } from './components/OutputPanel';
import { FloatingPanel } from './components/FloatingPanel';
import { MeasurementPanel } from './components/MeasurementPanel';
import { useEditorStore } from './stores/editorStore';
import { useThemeStore } from './stores/themeStore';
import { useEditorViewStore } from './stores/editorViewStore';
import { mountRoadToolsPlugin } from './plugins/roadTools.plugin';

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
  } = useEditorViewStore();

  useEffect(() => {
    initTheme();
    initLayout();
    const unmountRoadTools = mountRoadToolsPlugin();
    return unmountRoadTools;
  }, [initTheme, initLayout]);

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
      // Ctrl+D: duplicate selected road
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        useEditorStore.getState().duplicateSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLeftPanel, toggleRightPanel, toggleOutputPanel]);

  // Show right panel only when something is selected (Quick Inspector behavior)
  const showRightPanel = !layout.rightCollapsed && (!!selectedRoadId || !!selectedJunctionId);

  return (
    <ErrorBoundary t={(key, fallback) => t(key) || fallback || key}>
    <div className="app-container">
      {/* Full-bleed viewport as base layer */}
      <div className="canvas-viewport">
        <Viewport />
      </div>

      {/* Floating UI layers on top of viewport */}
      <MenuBar />
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
        >
          <LayerPanel />
        </FloatingPanel>
      )}

      {/* Floating template panel */}
      <FloatingPanel
        className="floating-template"
        dragHandleSelector=".template-header"
        defaultWidth={layout.leftWidth}
        minWidth={180}
        maxWidth={500}
        minHeight={80}
          resizeEdges={['top', 'right', 'bottom', 'left']}
          storageKey="we-panel-template"
      >
        <TemplatePanel />
      </FloatingPanel>

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
        >
          <PropertyPanel />
        </FloatingPanel>
      )}

      {/* Floating output panel */}
      {!layout.outputCollapsed && (
        <div className="floating-output">
          <OutputPanel />
        </div>
      )}

      {/* Floating status chips */}
      <StatusBar />
      <CommandPalette />
      <MeasurementPanel />
    </div>
    </ErrorBoundary>
  );
}
