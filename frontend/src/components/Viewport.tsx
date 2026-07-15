import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportRenderer } from '../viewport/renderer';
import { useProjectStore } from '../stores/projectStore';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { useViewportDrop } from '../hooks/useViewportDrop';
import { ViewportLoadingOverlay } from './ViewportLoadingOverlay';
import { useRubberBandSelect } from '../hooks/useRubberBandSelect';
import { useMoveRotateMode } from '../hooks/useMoveRotateMode';
import { useAdjustEdgeMode } from '../hooks/useAdjustEdgeMode';
import { useSplitMode } from '../hooks/useSplitMode';
import { useArcDrawMode } from '../hooks/useArcDrawMode';
import { useSpiralDrawMode } from '../hooks/useSpiralDrawMode';
import { useSplineDrawMode } from '../hooks/useSplineDrawMode';
import { useSplineDrawPreview } from '../hooks/useSplineDrawPreview';
import { useGeometryEditMode } from '../hooks/useGeometryEditMode';
import { useLaneLineEdit } from '../hooks/useLaneLineEdit';
import { useViewportKeyboard } from '../hooks/useViewportKeyboard';
import { useViewportMeshes } from '../hooks/useViewportMeshes';
import { useSelectionHighlight } from '../hooks/useSelectionHighlight';
import { useRoadLinkHighlight } from '../hooks/useRoadLinkHighlight';
import { useMeasureOverlay } from '../hooks/useMeasureOverlay';
import { useViewportTouch } from '../hooks/useViewportTouch';
import { useViewportHoverPick } from '../hooks/useViewportHoverPick';
import { useSignalPlacement } from '../hooks/useSignalPlacement';
import { useViewportEvents } from '../hooks/useViewportEvents';
import { useViewportInit } from '../hooks/useViewportInit';
import { useViewportSync } from '../hooks/useViewportSync';
import { usePointCloudViewport } from '../hooks/usePointCloudViewport';
import { useViewportPointerHandlers } from '../hooks/useViewportPointerHandlers';
import './Viewport.css';

import {
  MouseGestureState,
  type SplineControlPoint,
} from './viewportUtils';


export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ViewportRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unsupported'>('loading');
  const { isDragOver, isFileDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useViewportDrop(rendererRef, canvasRef);
  const { t } = useTranslation();
  const mouseGestureRef = useRef<MouseGestureState | null>(null);
  const isPreviewingRoadRef = useRef(false);
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredControlPointRef = useRef<SplineControlPoint | null>(null);
  const rubberBand = useRubberBandSelect(rendererRef, canvasRef);
  const { rubberBandOverlayRef } = rubberBand;
  const moveRotate = useMoveRotateMode(rendererRef, canvasRef, isPreviewingRoadRef, pendingCursorRef);
  const adjustEdge = useAdjustEdgeMode(rendererRef, canvasRef, isPreviewingRoadRef, pendingCursorRef);
  useMeasureOverlay({ rendererRef, canvasRef, status });
  const snapIndicatorDomRef = useRef<HTMLDivElement | null>(null);
  const splitIndicatorDomRef = useRef<HTMLDivElement | null>(null);

  // ── Extracted hooks ──
  useViewportInit(canvasRef, rendererRef, setStatus);
  useViewportSync(rendererRef, status);
  useViewportEvents(rendererRef, canvasRef);
  usePointCloudViewport({ rendererRef, status });

  // ── Mesh lifecycle (surface + lines + visible project + WASM cache) ──
  const { getVisibleProject, updateSurfaceMesh, updateLineMesh, getCachedLineVertices } = useViewportMeshes({
    rendererRef,
    status,
  });

  const arcDraw = useArcDrawMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    status,
  });
  const spiralDraw = useSpiralDrawMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    status,
    onPreviewEnd: useCallback(() => {
      void updateLineMesh();
    }, [updateLineMesh]),
  });
  const splineDraw = useSplineDrawMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    hoveredControlPointRef,
    status,
  });
  const geometryEdit = useGeometryEditMode({
    canvasRef,
    rendererRef,
    isPreviewingRoadRef,
    pendingCursorRef,
    hoveredControlPointRef,
    status,
  });

  const laneLine = useLaneLineEdit({
    canvasRef,
    rendererRef,
    status,
  });

  const split = useSplitMode({
    canvasRef,
    rendererRef,
    pendingCursorRef,
    splitIndicatorDomRef,
  });

  useViewportKeyboard();

  const hoverPick = useViewportHoverPick({
    rendererRef,
    canvasRef,
    getVisibleProject,
  });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useViewportTouch({
    rendererRef,
    canvasRef,
  });
  const signalPlacement = useSignalPlacement({
    rendererRef,
    canvasRef,
    pendingCursorRef,
  });

  // Real-time road mesh preview while adding knots in draw mode
  useSplineDrawPreview({
    rendererRef,
    status,
    onPreviewEnd: useCallback(() => {
      void updateSurfaceMesh();
      void updateLineMesh();
    }, [updateSurfaceMesh, updateLineMesh]),
    getCachedLineVertices,
  });

  // ── Selection highlight ──
  useSelectionHighlight({ rendererRef, status });

  // ── Road link (predecessor/successor) highlight ──
  useRoadLinkHighlight({ rendererRef, status });

  // Throttle Zustand cursor updates to once per animation frame
  useEffect(() => {
    let frameId = 0;
    const flush = () => {
      if (pendingCursorRef.current) {
        useProjectStore.getState().setCursorWorldPos(pendingCursorRef.current);
        pendingCursorRef.current = null;
      }
      frameId = requestAnimationFrame(flush);
    };
    frameId = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Wire plugin viewport overlays to the renderer
  const viewportOverlays = usePluginContribStore((s) => s.viewportOverlays);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setOverlayRenderers(
      viewportOverlays.map((o) => o.render),
      canvasRef.current ?? undefined,
    );
  }, [viewportOverlays]);

  const {
    handleMouseMove,
    handleMouseDown,
    handleClick,
    handleMouseUp,
    handleContextMenu,
    handleMouseLeave,
  } = useViewportPointerHandlers({
    refs: { mouseGestureRef, canvasRef, rendererRef, snapIndicatorDomRef, pendingCursorRef },
    rubberBand,
    moveRotate,
    adjustEdge,
    signalPlacement,
    laneLine,
    split,
    arcDraw,
    spiralDraw,
    splineDraw,
    geometryEdit,
    hoverPick,
    getVisibleProject,
  });

  return (
    <div
      className={`viewport${isDragOver ? ' viewport-drag-over' : ''}`}
      onMouseUp={handleMouseUp}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <canvas
        ref={canvasRef}
        className="viewport-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {/* Rubber-band selection overlay */}
      <div ref={rubberBandOverlayRef} className="selection-rect" />
      {/* Snap indicator: shown when cursor snaps to a nearby point */}
      <div ref={snapIndicatorDomRef} className="snap-indicator" style={{ display: 'none' }} />
      <div ref={splitIndicatorDomRef} className="split-indicator" style={{ display: 'none' }} />
      {status !== 'ready' && (
        <div className="viewport-overlay">
          <span className="viewport-label">
            {status === 'loading' ? t('viewport.initializing') : t('viewport.unsupported')}
          </span>
        </div>
      )}
      {/* File loading progress overlay */}
      <ViewportLoadingOverlay />
      {/* File drop zone hint */}
      {isFileDragOver && (
        <div className="viewport-file-drop-zone">
          <div className="viewport-file-drop-hint">
            <span className="viewport-file-drop-icon">📂</span>
            <span>{t('viewport.dropToOpen')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
