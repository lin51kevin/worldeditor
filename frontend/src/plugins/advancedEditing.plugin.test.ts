import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRegisterToolbarButton = vi.fn();
const mockRegisterMenuItem = vi.fn();
const mockRegisterContextMenuItem = vi.fn();
const mockUnregisterPlugin = vi.fn();

vi.mock('../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerToolbarButton: mockRegisterToolbarButton,
      registerMenuItem: mockRegisterMenuItem,
      registerContextMenuItem: mockRegisterContextMenuItem,
      unregisterPlugin: mockUnregisterPlugin,
    })),
  },
}));

vi.mock('../stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(() => ({
      project: { roads: [], junctions: [] },
      selectedRoadId: null,
      selectedJunctionId: null,
      selectedRoadIds: [],
      executePluginCommand: vi.fn(),
    })),
  },
}));

vi.mock('../utils/dialog', () => ({
  showAlert: vi.fn(),
}));

import { mountAdvancedEditingPlugin } from './advancedEditing.plugin';

describe('advancedEditing.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mount and return a cleanup function', () => {
    const cleanup = mountAdvancedEditingPlugin();
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('should register toolbar buttons on mount', () => {
    const cleanup = mountAdvancedEditingPlugin();
    expect(mockRegisterToolbarButton).toHaveBeenCalled();
    cleanup();
  });

  it('should register menu items on mount', () => {
    const cleanup = mountAdvancedEditingPlugin();
    expect(mockRegisterMenuItem).toHaveBeenCalled();
    cleanup();
  });

  it('should call unregisterPlugin on cleanup', () => {
    const cleanup = mountAdvancedEditingPlugin();
    cleanup();
    expect(mockUnregisterPlugin).toHaveBeenCalledWith('advanced-editing');
  });

  it('should register at least 5 menu items (one per major feature)', () => {
    const cleanup = mountAdvancedEditingPlugin();
    expect(mockRegisterMenuItem.mock.calls.length).toBeGreaterThanOrEqual(5);
    cleanup();
  });

  it('should register context menu items', () => {
    const cleanup = mountAdvancedEditingPlugin();
    expect(mockRegisterContextMenuItem).toHaveBeenCalled();
    cleanup();
  });
});
