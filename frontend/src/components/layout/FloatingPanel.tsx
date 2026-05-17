import { useRef, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import './FloatingPanel.css';
import { STORAGE_KEYS } from '../../constants/storage';

interface SavedState {
  tx: number;
  ty: number;
  width: number | null;
  height: number | null;
}

interface FloatingPanelProps {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
  /** CSS selector for the element inside this panel that acts as the drag handle */
  dragHandleSelector: string;
  /** Initial/default width (used if no saved state) */
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  /** Which edges are resizable */
  resizeEdges: Array<'top' | 'right' | 'bottom' | 'left'>;
  /** Which horizontal edge is the visual anchor. 'left' = panel grows rightward (default), 'right' = panel is CSS right-anchored */
  anchorHorizontal?: 'left' | 'right';
  /** localStorage key for persisting position/size */
  storageKey: string;
  /** Optional close callback — when provided a × button is rendered in the top-right corner */
  onClose?: () => void;
  /** Optional callback fired on any mousedown inside the panel (use to bring to front) */
  onMouseDown?: (e: React.MouseEvent) => void;
}

function loadState(key: string, defaultWidth: number): SavedState {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved) as SavedState;
  } catch {
    // ignore
  }
  return { tx: 0, ty: 0, width: defaultWidth, height: null };
}

function saveState(key: string, state: SavedState): void {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore
  }
}

/** Clear persisted position/size for all floating panels and reload so CSS defaults apply. */
export const PANEL_STORAGE_KEYS = [
  STORAGE_KEYS.PANEL_LEFT,
  STORAGE_KEYS.PANEL_RIGHT,
  STORAGE_KEYS.PANEL_TEMPLATE,
];

export function resetAllPanels(): void {
  PANEL_STORAGE_KEYS.forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });
  window.location.reload();
}

export function FloatingPanel({
  children,
  className = '',
  style,
  dragHandleSelector,
  defaultWidth,
  minWidth = 180,
  maxWidth = 600,
  minHeight = 150,
  resizeEdges,
  anchorHorizontal = 'left',
  storageKey,
  onClose,
  onMouseDown,
}: FloatingPanelProps) {
  const initialState = loadState(storageKey, defaultWidth);
  const [tx, setTx] = useState(initialState.tx);
  const [ty, setTy] = useState(initialState.ty);
  const [width, setWidth] = useState<number | null>(initialState.width);
  const [height, setHeight] = useState<number | null>(initialState.height);

  const containerRef = useRef<HTMLDivElement>(null);
  const txRef = useRef(tx);
  const tyRef = useRef(ty);

  // Drag state
  const drag = useRef<{
    startX: number; startY: number;
    origTx: number; origTy: number;
    origRect: DOMRect;
    committed: boolean;
  } | null>(null);
  // Track whether a real drag occurred (to suppress the following click)
  const didDrag = useRef(false);
  // Resize state
  const resize = useRef<{
    edge: 'top' | 'right' | 'bottom' | 'left' | 'bottom-right';
    startX: number;
    startY: number;
    origWidth: number;
    origHeight: number;
    origTx: number;
    origTy: number;
  } | null>(null);

  // Sync refs for stable callbacks
  txRef.current = tx;
  tyRef.current = ty;

  // Persist whenever state changes
  useEffect(() => {
    saveState(storageKey, { tx, ty, width, height });
  }, [tx, ty, width, height, storageKey]);

  // Drag: start when mousedown lands on the designated drag handle
  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      onMouseDown?.(e);
      const target = e.target as Element;
      if (!target.closest(dragHandleSelector)) return;
      // Don't intercept clicks on buttons inside the header
      if ((e.target as Element).tagName === 'BUTTON') return;
      // Don't preventDefault here — let clicks (e.g. collapse toggles) still fire
      const el = containerRef.current;
      drag.current = {
        startX: e.clientX, startY: e.clientY,
        origTx: tx, origTy: ty,
        origRect: el ? el.getBoundingClientRect() : new DOMRect(),
        committed: false,
      };
      document.body.style.userSelect = 'none';
    },
    [dragHandleSelector, tx, ty, onMouseDown],
  );

  // Resize: start on edge handle mousedown
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, edge: 'top' | 'right' | 'bottom' | 'left' | 'bottom-right') => {
      e.preventDefault();
      e.stopPropagation();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      resize.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        origWidth: width ?? rect.width,
        origHeight: height ?? rect.height,
        origTx: txRef.current,
        origTy: tyRef.current,
      };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = (edge === 'top' || edge === 'bottom') ? 'row-resize' : edge === 'bottom-right' ? 'nwse-resize' : 'col-resize';
    },
    [width, height],
  );

  // Clamp tx/ty so at least KEEP_PX pixels of the panel stay visible on screen.
  // origRect = panel's bounding rect at drag-start (already includes the CSS anchor position).
  const KEEP_PX = 40;
  const clampDrag = useCallback((origRect: DOMRect, origTx: number, origTy: number, dx: number, dy: number): [number, number] => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = origRect.width;
    const h = origRect.height;
    // Target visual top-left corner after applying dx/dy
    const tLeft = origRect.left + dx;
    const tTop  = origRect.top  + dy;
    // Clamp so panel is always at least KEEP_PX visible from each edge
    const clampedLeft = Math.max(KEEP_PX - w, Math.min(vw - KEEP_PX, tLeft));
    const clampedTop  = Math.max(KEEP_PX - h, Math.min(vh - KEEP_PX, tTop));
    return [origTx + (clampedLeft - origRect.left), origTy + (clampedTop - origRect.top)];
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (drag.current) {
        const dx = e.clientX - drag.current.startX;
        const dy = e.clientY - drag.current.startY;
        // Commit drag only after 5px threshold so pure clicks are unaffected
        if (!drag.current.committed) {
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
          drag.current.committed = true;
          didDrag.current = true;
          document.body.style.cursor = 'move';
        }
        const [cx, cy] = clampDrag(drag.current.origRect, drag.current.origTx, drag.current.origTy, dx, dy);
        setTx(cx);
        setTy(cy);
        return;
      }
      if (resize.current) {
        const { edge, startX, startY, origWidth, origHeight, origTx, origTy } = resize.current;
        if (edge === 'right') {
          const dx = e.clientX - startX;
          const newW = Math.max(minWidth, Math.min(maxWidth, origWidth + dx));
          setWidth(newW);
          if (anchorHorizontal === 'right') {
            // Right-anchored: shift tx so the RIGHT boundary moves, left boundary stays
            setTx(origTx + (newW - origWidth));
          }
        } else if (edge === 'left') {
          const dx = e.clientX - startX;
          const newW = Math.max(minWidth, Math.min(maxWidth, origWidth - dx));
          setWidth(newW);
          if (anchorHorizontal === 'left') {
            // Left-anchored: shift tx so the LEFT boundary moves, right boundary stays
            setTx(origTx + (origWidth - newW));
          }
        } else if (edge === 'bottom') {
          const newH = Math.max(minHeight, origHeight + (e.clientY - startY));
          setHeight(newH);
        } else if (edge === 'bottom-right') {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          const newW = Math.max(minWidth, Math.min(maxWidth, origWidth + dx));
          const newH = Math.max(minHeight, origHeight + dy);
          setWidth(newW);
          setHeight(newH);
          if (anchorHorizontal === 'right') {
            setTx(origTx + (newW - origWidth));
          }
        } else if (edge === 'top') {
          // Growing upward: bottom stays fixed, top edge moves → adjust ty + height together
          const dy = e.clientY - startY;
          const newH = Math.max(minHeight, origHeight - dy);
          const clampedDy = origHeight - newH; // actual dy after clamping
          setHeight(newH);
          setTy(origTy + clampedDy);
        }
      }
    };

    const onMouseUp = () => {
      if (drag.current && !drag.current.committed) {
        // Was a pure click, not a drag — reset userSelect only
        didDrag.current = false;
      }
      drag.current = null;
      resize.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [minWidth, maxWidth, minHeight, anchorHorizontal, clampDrag]);

  const panelStyle: CSSProperties = {
    ...style,
    transform: `translate(${tx}px, ${ty}px)`,
    ...(width !== null ? { width } : {}),
    ...(height !== null ? { height, bottom: 'auto' } : {}),
    overflow: 'visible', // allow resize handles at -4px to be visible outside the container
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={panelStyle}
      onMouseDown={handleContainerMouseDown}
      onClickCapture={(e) => {
        // Suppress child click events that fire at the end of a drag
        if (didDrag.current) {
          e.stopPropagation();
          didDrag.current = false;
        }
      }}
    >
      <div className="fp-inner">
        {children}
        {onClose && (
          <button className="fp-close-btn" onClick={onClose} title="关闭" type="button">
            <X size={12} />
          </button>
        )}
      </div>

      {resizeEdges.includes('top') && (
        <div
          className="fp-resize-handle fp-resize-top"
          onMouseDown={(e) => handleResizeMouseDown(e, 'top')}
        />
      )}
      {resizeEdges.includes('right') && (
        <div
          className="fp-resize-handle fp-resize-right"
          onMouseDown={(e) => handleResizeMouseDown(e, 'right')}
        />
      )}
      {resizeEdges.includes('left') && (
        <div
          className="fp-resize-handle fp-resize-left"
          onMouseDown={(e) => handleResizeMouseDown(e, 'left')}
        />
      )}
      {resizeEdges.includes('bottom') && (
        <div
          className="fp-resize-handle fp-resize-bottom"
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom')}
        />
      )}
      {(resizeEdges.includes('right') && resizeEdges.includes('bottom')) && (
        <div
          className="fp-resize-handle fp-resize-corner-br"
          onMouseDown={(e) => handleResizeMouseDown(e, 'bottom-right')}
        />
      )}
    </div>
  );
}
