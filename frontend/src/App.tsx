import { useEffect, useCallback } from 'react';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { Viewport } from './components/Viewport';
import { PropertyPanel } from './components/PropertyPanel';
import { TemplatePanel } from './components/TemplatePanel';
import { StatusBar } from './components/StatusBar';
import { CommandPalette } from './components/CommandPalette';
import { OutputPanel } from './components/OutputPanel';
import { useEditorStore } from './stores/editorStore';
import { useThemeStore } from './stores/themeStore';
import { useEditorViewStore } from './stores/editorViewStore';

export function App() {
  const { undo, redo, canUndo, canRedo, selectedRoadId } = useEditorStore();
  const { initTheme } = useThemeStore();
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
  }, [initTheme, initLayout]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo()) undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
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
        e.preventDefault();
        toggleLeftPanel();
      }
      // I: toggle inspector/right panel
      if (e.key === 'i' || e.key === 'I') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        toggleRightPanel();
      }
      // Ctrl+J: toggle output panel
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        toggleOutputPanel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, canUndo, canRedo, toggleLeftPanel, toggleRightPanel, toggleOutputPanel]);

  // Show right panel only when something is selected (Quick Inspector behavior)
  const showRightPanel = !layout.rightCollapsed && !!selectedRoadId;

  return (
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
        <div className="floating-left">
          <LayerPanel />
          <div className="floating-left-divider" />
          <TemplatePanel />
        </div>
      )}

      {/* Floating right panel — Quick Inspector (only when selected) */}
      {showRightPanel && (
        <div className="floating-right">
          <PropertyPanel />
        </div>
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
    </div>
  );
}
