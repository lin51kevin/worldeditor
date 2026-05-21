import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VirtualList } from './VirtualList';

const ITEM_HEIGHT = 32;
const VISIBLE_HEIGHT = 200;

/** Generate N mock items with stable labels */
function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}` }));
}

function renderVirtualList(count: number, height = VISIBLE_HEIGHT) {
  const items = makeItems(count);
  return render(
    <VirtualList
      items={items}
      height={height}
      estimatedItemHeight={ITEM_HEIGHT}
      overscan={3}
      renderItem={(item) => <div key={item.id}>{item.label}</div>}
      getItemKey={(item) => item.id}
    />,
  );
}

describe('VirtualList', () => {
  it('renders all items when count is below threshold (50)', () => {
    renderVirtualList(30);
    // All 30 items should be in the DOM
    for (let i = 0; i < 30; i++) {
      expect(screen.getByText(`Item ${i}`)).toBeInTheDocument();
    }
  });

  it('only renders visible items + overscan when count exceeds threshold', () => {
    const { container } = renderVirtualList(200);
    const allTexts = container.querySelectorAll('div');
    // Visible: 200/32 ≈ 6 + overscan 3*2 = 12, so well below 200
    const itemCount = Array.from(allTexts).filter((el) => el.textContent?.startsWith('Item ')).length;
    expect(itemCount).toBeLessThan(50);
    expect(itemCount).toBeGreaterThan(0);
  });

  it('sets correct total height for scroll container', () => {
    const { container } = renderVirtualList(200);
    const inner = container.querySelector('.virtual-list-inner') as HTMLElement | null;
    expect(inner).toBeTruthy();
    // Total height should be 200 * 32 = 6400
    expect(inner!.style.height).toBe(`${200 * ITEM_HEIGHT}px`);
  });

  it('renders nothing for empty list', () => {
    const { container } = renderVirtualList(0);
    expect(container.querySelector('.virtual-list-inner')?.children.length ?? 0).toBe(0);
  });
});
