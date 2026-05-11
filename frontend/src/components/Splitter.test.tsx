import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Splitter } from './Splitter';

describe('Splitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with default vertical direction', () => {
    const onResize = vi.fn();
    const { container } = render(<Splitter onResize={onResize} />);
    const el = container.querySelector('.splitter') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.classList.contains('splitter-horizontal')).toBe(false);
  });

  it('renders with horizontal class when horizontal', () => {
    const onResize = vi.fn();
    const { container } = render(<Splitter direction="horizontal" onResize={onResize} />);
    const el = container.querySelector('.splitter') as HTMLElement;
    expect(el.classList.contains('splitter-horizontal')).toBe(true);
  });

  it('triggers onDoubleClick when double-clicked', () => {
    const onResize = vi.fn();
    const onDoubleClick = vi.fn();
    const { container } = render(
      <Splitter onResize={onResize} onDoubleClick={onDoubleClick} />,
    );
    const el = container.querySelector('.splitter') as HTMLElement;
    fireEvent.doubleClick(el);
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('calls onResize during mouse drag (vertical)', () => {
    const onResize = vi.fn();
    const { container } = render(<Splitter onResize={onResize} />);
    const el = container.querySelector('.splitter') as HTMLElement;

    fireEvent.mouseDown(el, { clientX: 100, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 150, clientY: 200 });
    expect(onResize).toHaveBeenCalledWith(50);

    fireEvent.mouseUp(window);
  });

  it('calls onResize with y delta for horizontal direction', () => {
    const onResize = vi.fn();
    const { container } = render(<Splitter direction="horizontal" onResize={onResize} />);
    const el = container.querySelector('.splitter') as HTMLElement;

    fireEvent.mouseDown(el, { clientX: 100, clientY: 200 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 230 });
    expect(onResize).toHaveBeenCalledWith(30);

    fireEvent.mouseUp(window);
  });

  it('stops resizing on mouseup', () => {
    const onResize = vi.fn();
    const { container } = render(<Splitter onResize={onResize} />);
    const el = container.querySelector('.splitter') as HTMLElement;

    fireEvent.mouseDown(el, { clientX: 100, clientY: 0 });
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 200, clientY: 0 });
    expect(onResize).not.toHaveBeenCalled();
  });
});
