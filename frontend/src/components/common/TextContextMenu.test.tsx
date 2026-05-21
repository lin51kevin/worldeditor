import { act, render } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { TextContextMenu } from './TextContextMenu';

/** Dispatch a native contextmenu event on the given element. */
function fireContextMenu(el: HTMLElement) {
  el.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }),
  );
}

describe('TextContextMenu', () => {
  // Clean up any elements appended manually to document.body after each test.
  const appended: HTMLElement[] = [];
  afterEach(() => {
    appended.forEach((el) => el.remove());
    appended.length = 0;
  });

  function attach<T extends HTMLElement>(el: T): T {
    document.body.appendChild(el);
    appended.push(el);
    return el;
  }

  it('does NOT show menu when right-clicking a <canvas> element', () => {
    render(<TextContextMenu />);
    const canvas = attach(document.createElement('canvas'));

    act(() => fireContextMenu(canvas));

    expect(document.querySelector('.text-context-menu')).toBeNull();
  });

  it('shows menu when right-clicking an <input> element', () => {
    render(<TextContextMenu />);
    const input = attach(document.createElement('input'));

    act(() => fireContextMenu(input));

    expect(document.querySelector('.text-context-menu')).not.toBeNull();
  });

  it('shows menu when right-clicking a <textarea> element', () => {
    render(<TextContextMenu />);
    const textarea = attach(document.createElement('textarea'));

    act(() => fireContextMenu(textarea));

    expect(document.querySelector('.text-context-menu')).not.toBeNull();
  });

  it('does NOT show menu when right-clicking a plain <div> with no selection', () => {
    render(<TextContextMenu />);
    const div = attach(document.createElement('div'));

    act(() => fireContextMenu(div));

    expect(document.querySelector('.text-context-menu')).toBeNull();
  });

  it('shows Cut, Copy, Paste items for editable elements', () => {
    render(<TextContextMenu />);
    const input = attach(document.createElement('input'));

    act(() => fireContextMenu(input));

    const menu = document.querySelector('.text-context-menu');
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain('Ctrl+X'); // Cut shortcut
    expect(menu!.textContent).toContain('Ctrl+C'); // Copy shortcut
    expect(menu!.textContent).toContain('Ctrl+V'); // Paste shortcut
    expect(menu!.textContent).toContain('Ctrl+A'); // Select All shortcut
  });

  it('closes menu on Escape key', () => {
    render(<TextContextMenu />);
    const input = attach(document.createElement('input'));

    act(() => fireContextMenu(input));
    expect(document.querySelector('.text-context-menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.querySelector('.text-context-menu')).toBeNull();
  });

  it('closes menu on click elsewhere', () => {
    render(<TextContextMenu />);
    const input = attach(document.createElement('input'));

    act(() => fireContextMenu(input));
    expect(document.querySelector('.text-context-menu')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('.text-context-menu')).toBeNull();
  });
});
