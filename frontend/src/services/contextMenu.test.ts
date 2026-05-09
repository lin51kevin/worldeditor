import { describe, it, expect, beforeEach } from 'vitest';
import { registerContextMenu, getMenu, showContextMenu } from './contextMenu';
import type { MenuItem } from './contextMenu';

describe('contextMenu service', () => {
  beforeEach(() => {
    // Clear any existing registrations by re-registering test providers
  });

  it('should register and retrieve menu items', () => {
    const items: MenuItem[] = [
      { label: 'Test Item', action: () => {} },
    ];
    registerContextMenu('test', () => items);
    const result = getMenu('test', 0, 0);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Test Item');
  });

  it('should return empty array for unregistered context', () => {
    const result = getMenu('unknown', 0, 0);
    expect(result).toEqual([]);
  });

  it('should pass position to provider', () => {
    let capturedX = 0, capturedY = 0;
    registerContextMenu('pos-test', (_ctx, x, y) => {
      capturedX = x;
      capturedY = y;
      return [{ label: 'ok' }];
    });
    getMenu('pos-test', 42, 99);
    expect(capturedX).toBe(42);
    expect(capturedY).toBe(99);
  });

  it('should dispatch showContextMenu event', () => {
    let received = false;
    const handler = () => { received = true; };
    document.addEventListener('contextmenu:show', handler);
    showContextMenu(10, 20, 'viewport');
    document.removeEventListener('contextmenu:show', handler);
    expect(received).toBe(true);
  });

  it('should support separators', () => {
    const items: MenuItem[] = [
      { label: 'Item 1' },
      { separator: true, label: '' },
      { label: 'Item 2' },
    ];
    registerContextMenu('sep-test', () => items);
    const result = getMenu('sep-test', 0, 0);
    expect(result).toHaveLength(3);
    expect(result[1]!.separator).toBe(true);
  });

  it('should support submenu items', () => {
    const items: MenuItem[] = [
      { label: 'Parent', submenu: [{ label: 'Child' }] },
    ];
    registerContextMenu('sub-test', () => items);
    const result = getMenu('sub-test', 0, 0);
    expect(result[0]!.submenu).toHaveLength(1);
  });
});
