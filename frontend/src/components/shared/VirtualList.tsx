import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

/**
 * Threshold below which all items are rendered normally (no virtualization).
 */
const VIRTUAL_THRESHOLD = 50;

interface VirtualListProps<T> {
  items: T[];
  height: number;
  estimatedItemHeight: number;
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
  getItemKey: (item: T, index: number) => string;
  className?: string;
}

/**
 * Simple virtual list: renders only visible items + overscan buffer.
 * Falls back to normal rendering when item count < VIRTUAL_THRESHOLD.
 * Uses fixed estimated row height (acceptable for LayerPanel items).
 */
export function VirtualList<T>({
  items,
  height,
  estimatedItemHeight,
  overscan = 3,
  renderItem,
  getItemKey,
  className = '',
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  // Reset scroll when items change significantly
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [items.length]);

  const totalHeight = items.length * estimatedItemHeight;

  // Below threshold: render all items normally
  if (items.length < VIRTUAL_THRESHOLD) {
    return (
      <div ref={containerRef} className={className} style={{ height, overflow: 'auto' }}>
        {items.map((item, index) => renderItem(item, index))}
      </div>
    );
  }

  // Virtual rendering
  const startIdx = Math.max(0, Math.floor(scrollTop / estimatedItemHeight) - overscan);
  const visibleCount = Math.ceil(height / estimatedItemHeight);
  const endIdx = Math.min(items.length, startIdx + visibleCount + overscan * 2);

  const visibleItems = items.slice(startIdx, endIdx);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height, overflow: 'auto' }}
      onScroll={handleScroll}
    >
      <div className="virtual-list-inner" style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems.map((item, localIdx) => {
          const globalIdx = startIdx + localIdx;
          return (
            <div
              key={getItemKey(item, globalIdx)}
              style={{
                position: 'absolute',
                top: globalIdx * estimatedItemHeight,
                left: 0,
                right: 0,
              }}
            >
              {renderItem(item, globalIdx)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
