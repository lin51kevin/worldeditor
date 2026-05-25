/**
 * useViewportInit — initialize the WebGPU renderer and handle canvas resize.
 */
import { useEffect, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { ViewportRenderer } from '../viewport/renderer';
import { useProjectStore } from '../stores/projectStore';

export function useViewportInit(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  rendererRef: RefObject<ViewportRenderer | null>,
  setStatus: Dispatch<SetStateAction<'loading' | 'ready' | 'unsupported'>>,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!ViewportRenderer.isSupported()) {
      setStatus('unsupported');
      return;
    }

    const renderer = new ViewportRenderer();
    (rendererRef as { current: ViewportRenderer | null }).current = renderer;

    const initRenderer = async () => {
      const tMount = performance.now();
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = Math.floor(rect.width * devicePixelRatio);
        canvas.height = Math.floor(rect.height * devicePixelRatio);
      }

      const ok = await renderer.init(canvas);
      const tInit = performance.now();
      if (ok) {
        setStatus('ready');
        renderer.start();
        renderer.setScaleChangeCallback((info) => {
          useProjectStore.getState().setViewportInfo(info);
        });
        console.info(`[Viewport:perf] mount→ready ${(tInit - tMount).toFixed(1)}ms`);
      } else {
        setStatus('unsupported');
      }
    };

    initRenderer();

    const observer = new ResizeObserver((entries) => {
      requestAnimationFrame(() => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          const w = Math.floor(width * devicePixelRatio);
          const h = Math.floor(height * devicePixelRatio);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            renderer.resize(w, h);
          }
        }
      });
    });
    observer.observe(canvas.parentElement!);

    return () => {
      observer.disconnect();
      renderer.dispose();
      (rendererRef as { current: ViewportRenderer | null }).current = null;
    };
  }, []);
}
