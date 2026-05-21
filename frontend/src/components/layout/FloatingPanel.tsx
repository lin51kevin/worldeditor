import { useRef, useState, useCallback, useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import './FloatingPanel.css';
import { STORAGE_KEYS } from '../../constants/storage';

/** Format version 2 — unified rect {x,y,w,h}. Version 1 used tx/ty and is discarded. */
const STATE_VERSION = 2;


interface Rect { x: number; y: number; w: number; h: number }

type Edge = 'top' | 'right' | 'bottom' | 'left';

interface HandleDef {
  /** Short id used for compact edge.includes() resize logic */
  id: string;
  /** Single resizable edge, or null for corners */
  edge: Edge | null;
  /** Two edges that must both be enabled for this corner to appear */
  paired: [Edge, Edge] | null;
}

/** 8-direction handles: 4 edges + 4 corners (derived from resizeEdges prop) */
const ALL_HANDLES: HandleDef[] = [
  { id: 'r',  edge: 'right',  paired: null },
  { id: 'b',  edge: 'bottom', paired: null },
  { id: 'l',  edge: 'left',   paired: null },
  { id: 't',  edge: 'top',    paired: null },
  { id: 'rb', edge: null, paired: ['right', 'bottom'] },
  { id: 'lb', edge: null, paired: ['left',  'bottom'] },
  { id: 'rt', edge: null, paired: ['right', 'top']    },
  { id: 'lt', edge: null, paired: ['left',  'top']    },
];

/** Maps short handle id → CSS class name */
const HANDLE_CSS: Record<string, string> = {
  r: 'fp-resize-right',     l: 'fp-resize-left',
  t: 'fp-resize-top',       b: 'fp-resize-bottom',
  rb: 'fp-resize-corner-br', lb: 'fp-resize-corner-lb',
  rt: 'fp-resize-corner-rt', lt: 'fp-resize-corner-lt',
};

/** Cursor style applied to document.body during an active resize */
const HANDLE_CURSOR: Record<string, string> = {
  r: 'ew-resize',    l: 'ew-resize',
  t: 'ns-resize',    b: 'ns-resize',
  rb: 'nwse-resize', lt: 'nwse-resize',
  rt: 'nesw-resize', lb: 'nesw-resize',
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function loadRect(key: string): Rect | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Record<string, unknown>;
    // Discard old tx/ty format (v1) or any unrecognised format
    if ('tx' in p || typeof p.x !== 'number') return null;
    if ((p.v as number | undefined ?? 0) < STATE_VERSION) return null;
    return { x: p.x as number, y: p.y as number, w: p.w as number, h: p.h as number };
  } catch {
    return null;
  }
}

function saveRect(key: string, rect: Rect): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ...rect, v: STATE_VERSION }));
  } catch { /* ignore */ }
}

/** All floating panel storage keys (used by resetAllPanels). */
export const PANEL_STORAGE_KEYS = [
  STORAGE_KEYS.PANEL_LEFT,
  STORAGE_KEYS.PANEL_RIGHT,
  STORAGE_KEYS.PANEL_TEMPLATE,
];

/** Clear persisted position/size for all floating panels and notify components to reset. */
export function resetAllPanels(): void {
  PANEL_STORAGE_KEYS.forEach((k) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  });
  window.dispatchEvent(new CustomEvent('panels:reset'));
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
  /** Which edges are resizable (corners are auto-derived from adjacent enabled edges) */
  resizeEdges: Array<Edge>;
  /** localStorage key for persisting position/size */
  storageKey: string;
  /** Optional close callback — when provided a × button is rendered in the top-right corner */
  onClose?: () => void;
  /** Optional callback fired on any mousedown inside the panel (use to bring to front) */
  onMouseDown?: (e: React.MouseEvent) => void;
  /** When true and no saved position exists, the panel opens centered in the viewport */
  initialCenter?: boolean;
  /** Additional pixel offset applied to the centered position (useful to stagger multiple panels) */
  initialCenterOffset?: { x: number; y: number };
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
  storageKey,
  onClose,
  onMouseDown,
  initialCenter,
  initialCenterOffset,
}: FloatingPanelProps) {
  // null = first frame, let CSS class control position; rect is set in useLayoutEffect
  const [rect, setRect] = useState<Rect | null>(() => loadRect(storageKey));
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state (mouse-offset + original position snapshot)
  const drag = useRef<{
    sx: number; sy: number;
    ox: number; oy: number;
    ow: number; oh: number;
    committed: boolean;
  } | null>(null);
  // Suppress child click events that fire at the end of a drag
  const didDrag = useRef(false);
  // Resize state
  const resize = useRef<{ id: string; sx: number; sy: number; origin: Rect } | null>(null);

  // Listen for global panel reset event
  useEffect(() => {
    const handler = () => {
      setRect(null);
      localStorage.removeItem(storageKey);
      // Trigger re-layout on next frame to pick up CSS defaults
      requestAnimationFrame(() => {
        const el = containerRef.current;
        if (!el) return;
        const brc = el.getBoundingClientRect();
        setRect({
          x: initialCenter
            ? Math.round((window.innerWidth - brc.width) / 2) + (initialCenterOffset?.x ?? 0)
            : Math.round(brc.left),
          y: initialCenter
            ? Math.round((window.innerHeight - brc.height) / 2) + (initialCenterOffset?.y ?? 0)
            : Math.round(brc.top),
          w: Math.round(brc.width) || defaultWidth,
          h: Math.round(brc.height),
        });
      });
    };
    window.addEventListener('panels:reset', handler);
    return () => window.removeEventListener('panels:reset', handler);
  }, [defaultWidth, initialCenter, initialCenterOffset]);

  // Persist rect to localStorage on every change
  useEffect(() => {
    if (rect !== null) saveRect(storageKey, rect);
  }, [rect, storageKey]);

  // On first mount with no saved state: read actual position/size from CSS layout.
  // useLayoutEffect fires synchronously before paint — zero visible flash.
  // getBoundingClientRect() is used instead of offsetLeft/Top because plugin panels
  // use position:fixed and offsetLeft/Top is unreliable for fixed elements.
  useLayoutEffect(() => {
    if (rect !== null) return;
    const el = containerRef.current;
    if (!el) return;
    const brc = el.getBoundingClientRect();
    const w = Math.round(brc.width) || defaultWidth;
    const h = Math.round(brc.height);
    const x = initialCenter
      ? Math.round((window.innerWidth  - w) / 2) + (initialCenterOffset?.x ?? 0)
      : Math.round(brc.left);
    const y = initialCenter
      ? Math.round((window.innerHeight - h) / 2) + (initialCenterOffset?.y ?? 0)
      : Math.round(brc.top);
    // Set rect immediately; in test environments requestAnimationFrame may not advance.
    // Keeping this synchronous avoids missing initial layout in jsdom-based tests.
    setRect({ x, y, w, h });
    return;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-clamp position when the browser viewport is resized
  useEffect(() => {
    const onResize = () =>
      setRect((r) =>
        r ? {
          ...r,
          x: clamp(r.x, 0, window.innerWidth  - r.w),
          y: clamp(r.y, 0, window.innerHeight - r.h),
        } : r,
      );
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Global mouse-move / mouse-up for drag and resize
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (drag.current) {
        const dx = e.clientX - drag.current.sx;
        const dy = e.clientY - drag.current.sy;
        // Commit only after 5px threshold so pure clicks are unaffected
        if (!drag.current.committed) {
          if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
          drag.current.committed = true;
          didDrag.current = true;
          document.body.style.cursor = 'move';
        }
        const { ox, oy, ow, oh } = drag.current;
        setRect((r) => r ? {
          ...r,
          x: clamp(ox + dx, 0, window.innerWidth  - ow),
          y: clamp(oy + dy, 0, window.innerHeight - oh),
        } : r);
        return;
      }
      if (resize.current) {
        const { id, sx, sy, origin } = resize.current;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        // Compact all-direction resize logic — each handle id encodes its direction(s)
        setRect(() => {
          const n = { ...origin };
          if (id.includes('r')) n.w = clamp(origin.w + dx, minWidth, maxWidth);
          if (id.includes('b')) n.h = Math.max(minHeight, origin.h + dy);
          if (id.includes('l')) { const w = clamp(origin.w - dx, minWidth, maxWidth); n.x = origin.x + origin.w - w; n.w = w; }
          if (id.includes('t')) { const h = Math.max(minHeight, origin.h - dy); n.y = origin.y + origin.h - h; n.h = h; }
          return n;
        });
      }
    };

    const onMouseUp = () => {
      if (drag.current && !drag.current.committed) didDrag.current = false;
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
  }, [minWidth, maxWidth, minHeight]);

  const handleContainerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      onMouseDown?.(e);
      const target = e.target as Element;
      if (!target.closest(dragHandleSelector)) return;
      // Don't intercept clicks on buttons inside the header
      if ((e.target as Element).tagName === 'BUTTON') return;
      const r = rectRef.current;
      drag.current = {
        sx: e.clientX, sy: e.clientY,
        ox: r?.x ?? 0, oy: r?.y ?? 0,
        ow: r?.w ?? defaultWidth, oh: r?.h ?? 300,
        committed: false,
      };
      document.body.style.userSelect = 'none';
    },
    [dragHandleSelector, onMouseDown, defaultWidth],
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      const el = containerRef.current;
      if (!el) return;
      const r = rectRef.current ?? {
        x: el.offsetLeft, y: el.offsetTop,
        w: el.offsetWidth, h: el.offsetHeight,
      };
      resize.current = { id, sx: e.clientX, sy: e.clientY, origin: { ...r } };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = HANDLE_CURSOR[id] ?? 'default';
    },
    [],
  );

  // Derive which handles to render from resizeEdges prop
  const visibleHandles = ALL_HANDLES.filter((h) =>
    h.edge !== null
      ? resizeEdges.includes(h.edge)
      : (h.paired as Edge[]).every((e) => resizeEdges.includes(e)),
  );

  // When rect is set: absolute left/top/width/height (overrides CSS class position).
  // When rect is null (first render): let CSS class control layout — no position override.
  const panelStyle: CSSProperties = rect
    ? {
        ...style,
        position: 'fixed',
        left: rect.x,
        top: rect.y,
        right: 'auto',
        bottom: 'auto',
        width: rect.w,
        height: rect.h,
        overflow: 'visible',
      }
    : { ...style, overflow: 'visible' };

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

      {visibleHandles.map(({ id }) => (
        <div
          key={id}
          className={`fp-resize-handle ${HANDLE_CSS[id]}`}
          onMouseDown={(e) => handleResizeMouseDown(e, id)}
        />
      ))}
    </div>
  );
}
