import { useCallback, useRef, useEffect } from 'react';

interface SplitterProps {
  direction?: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onDoubleClick?: () => void;
}

/// Draggable splitter handle for resizable panels.
export function Splitter({ direction = 'vertical', onResize, onDoubleClick }: SplitterProps) {
  const dragging = useRef(false);
  const splitterRef = useRef<HTMLDivElement>(null);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastPos.current = direction === 'vertical' ? e.clientX : e.clientY;
      splitterRef.current?.classList.add('dragging');
      document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [direction],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const currentPos = direction === 'vertical' ? e.clientX : e.clientY;
      const delta = currentPos - lastPos.current;
      if (delta !== 0) {
        onResize(delta);
        lastPos.current = currentPos;
      }
    };

    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      splitterRef.current?.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [direction, onResize]);

  return (
    <div
      ref={splitterRef}
      className={`splitter ${direction === 'horizontal' ? 'splitter-horizontal' : ''}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
