/**
 * useViewportEvents — handle incoming viewport event bus messages
 * (zoom-to-fit, pan-to-road, set-dimension, capture-screenshot, etc.)
 */
import { useEffect, type RefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { onViewportEvent } from '../viewport/viewportEvents';
import { useProjectStore } from '../stores/projectStore';
import { getPlatformService } from '../services';

export function useViewportEvents(
  rendererRef: RefObject<ViewportRenderer | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  useEffect(() => {
    const unsubscribe = onViewportEvent((event) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      switch (event.type) {
        case 'zoom-to-fit':
          renderer.fitToVertices();
          break;
        case 'zoom-to-selected':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useProjectStore.getState();
              const road = currentProject.roads.find((r) => r.id === event.roadId);
              if (!road) return;
              const verts = await service.generateSingleRoadVertices(road, 2.0, [0.2, 0.5, 1.0, 0.7]);
              renderer.fitToVertices(verts);
            } catch (err) {
              console.error('[Viewport] zoom-to-selected failed:', err);
            }
          })();
          break;
        case 'zoom-to-junction':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useProjectStore.getState();
              const verts = await service.generateSingleJunctionVertices(
                currentProject,
                event.junctionId,
                [0.7, 0.4, 1.0, 0.65],
              );
              renderer.fitToVertices(verts);
            } catch (err) {
              console.error('[Viewport] zoom-to-junction failed:', err);
            }
          })();
          break;
        case 'pan-to-road':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useProjectStore.getState();
              const road = currentProject.roads.find((r) => r.id === event.roadId);
              if (!road) return;
              const verts = await service.generateSingleRoadVertices(road, 2.0, [0.2, 0.5, 1.0, 0.7]);
              if (verts.length > 0) renderer.panToCenter(verts);
            } catch (err) {
              console.error('[Viewport] pan-to-road failed:', err);
            }
          })();
          break;
        case 'pan-to-junction':
          (async () => {
            try {
              const service = await getPlatformService();
              const { project: currentProject } = useProjectStore.getState();
              const verts = await service.generateSingleJunctionVertices(
                currentProject,
                event.junctionId,
                [0.7, 0.4, 1.0, 0.65],
              );
              if (verts.length > 0) renderer.panToCenter(verts);
            } catch (err) {
              console.error('[Viewport] pan-to-junction failed:', err);
            }
          })();
          break;
        case 'pan-to-signal': {
          (async () => {
            try {
              const service = await getPlatformService();
              const pos = await service.getSignalWorldPosCached(event.roadId, event.signalId);
              if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                const sz = 1.0;
                const synth = new Float32Array([
                  pos.x - sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x + sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x,      pos.y + sz, 0, 1, 1, 1, 1,
                ]);
                renderer.panToCenter(synth);
              }
            } catch (err) {
              console.error('[Viewport] pan-to-signal failed:', err);
            }
          })();
          break;
        }
        case 'pan-to-object': {
          (async () => {
            try {
              const service = await getPlatformService();
              const pos = await service.getObjectWorldPosCached(event.roadId, event.objectId);
              if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                const sz = 1.0;
                const synth = new Float32Array([
                  pos.x - sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x + sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x,      pos.y + sz, 0, 1, 1, 1, 1,
                ]);
                renderer.panToCenter(synth);
              }
            } catch (err) {
              console.error('[Viewport] pan-to-object failed:', err);
            }
          })();
          break;
        }
        case 'pan-to-lane': {
          (async () => {
            try {
              const service = await getPlatformService();
              const pos = await service.getLaneWorldPosCached(event.roadId, event.sectionIndex, event.laneId);
              if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                const sz = 1.0;
                const synth = new Float32Array([
                  pos.x - sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x + sz, pos.y - sz, 0, 1, 1, 1, 1,
                  pos.x,      pos.y + sz, 0, 1, 1, 1, 1,
                ]);
                renderer.panToCenter(synth);
              }
            } catch (err) {
              console.error('[Viewport] pan-to-lane failed:', err);
            }
          })();
          break;
        }
        case 'set-dimension':
          renderer.setDimension(event.dimension);
          break;
        case 'set-show-grid':
          renderer.setShowGrid(event.show);
          break;
        case 'set-show-axis':
          renderer.setShowAxis(event.show);
          break;
        case 'capture-screenshot': {
          const canvas = canvasRef.current;
          if (!canvas) break;
          try {
            const dataUrl = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = event.filename ?? `worldeditor-${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch (err) {
            console.error('[Viewport] Screenshot capture failed:', err);
          }
          break;
        }
      }
    });
    return unsubscribe;
  }, []);
}
