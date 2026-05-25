/**
 * useViewportSync — sync editor view settings (grid, axis, dimension, viewMode, theme) to the renderer.
 */
import { useEffect, type RefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { useViewportStore } from '../stores/viewportStore';
import { useThemeStore } from '../stores/themeStore';

export function useViewportSync(
  rendererRef: RefObject<ViewportRenderer | null>,
  status: 'loading' | 'ready' | 'unsupported',
) {
  const showGrid = useViewportStore((s) => s.showGrid);
  const showAxis = useViewportStore((s) => s.showAxis);
  const dimension = useViewportStore((s) => s.dimension);
  const viewMode = useViewportStore((s) => s.viewMode);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    renderer.setShowGrid(showGrid);
    renderer.setShowAxis(showAxis);
  }, [showGrid, showAxis, status]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    renderer.setDimension(dimension);
  }, [dimension, status]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    renderer.setViewMode(viewMode);
  }, [viewMode, status]);

  useEffect(() => {
    const handler = () => {
      const renderer = rendererRef.current;
      if (!renderer || status !== 'ready') return;
      const dim = useViewportStore.getState().dimension;
      renderer.resetCamera(dim);
    };
    window.addEventListener('viewport:resetCamera', handler);
    return () => window.removeEventListener('viewport:resetCamera', handler);
  }, [status]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || status !== 'ready') return;
    try {
      const style = getComputedStyle(document.documentElement);
      const r = parseFloat(style.getPropertyValue('--color-viewport-clear-r')) || 0.10;
      const g = parseFloat(style.getPropertyValue('--color-viewport-clear-g')) || 0.10;
      const b = parseFloat(style.getPropertyValue('--color-viewport-clear-b')) || 0.12;
      renderer.setClearColor(r, g, b);
      const gr = parseFloat(style.getPropertyValue('--color-viewport-grid-r')) || 0.35;
      const gg = parseFloat(style.getPropertyValue('--color-viewport-grid-g')) || 0.35;
      const gb = parseFloat(style.getPropertyValue('--color-viewport-grid-b')) || 0.35;
      renderer.setGridColor(gr, gg, gb);
    } catch {
      // CSS custom properties unavailable in test environment
    }
  }, [theme, status]);
}
