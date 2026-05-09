import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorViewStore } from './editorViewStore';

describe('editorViewStore', () => {
  beforeEach(() => {
    useEditorViewStore.setState({
      dimension: '3d',
      showGrid: true,
      showAxis: true,
      editMode: 'select',
      viewMode: 'solid',
      layout: {
        leftWidth: 260,
        rightWidth: 300,
        outputHeight: 150,
        leftCollapsed: false,
        rightCollapsed: false,
        outputCollapsed: true,
      },
    });
  });

  it('has the expected initial state', () => {
    const state = useEditorViewStore.getState();

    expect(state.dimension).toBe('3d');
    expect(state.showGrid).toBe(true);
    expect(state.showAxis).toBe(true);
    expect(state.editMode).toBe('select');
    expect(state.viewMode).toBe('solid');
    expect(state.layout.leftWidth).toBe(260);
    expect(state.layout.rightWidth).toBe(300);
    expect(state.layout.leftCollapsed).toBe(false);
    expect(state.layout.rightCollapsed).toBe(false);
  });

  it('setDimension changes the dimension', () => {
    act(() => {
      useEditorViewStore.getState().setDimension('2d');
    });

    expect(useEditorViewStore.getState().dimension).toBe('2d');
  });

  it('toggleGrid flips showGrid', () => {
    act(() => {
      useEditorViewStore.getState().toggleGrid();
    });

    expect(useEditorViewStore.getState().showGrid).toBe(false);
  });

  it('toggleGrid twice returns to the original value', () => {
    act(() => {
      useEditorViewStore.getState().toggleGrid();
      useEditorViewStore.getState().toggleGrid();
    });

    expect(useEditorViewStore.getState().showGrid).toBe(true);
  });

  it('toggleAxis flips showAxis', () => {
    act(() => {
      useEditorViewStore.getState().toggleAxis();
    });

    expect(useEditorViewStore.getState().showAxis).toBe(false);
  });

  it.each(['select', 'road', 'lane', 'junction'] as const)(
    'setEditMode changes editMode to %s',
    (editMode) => {
      act(() => {
        useEditorViewStore.getState().setEditMode(editMode);
      });

      expect(useEditorViewStore.getState().editMode).toBe(editMode);
    }
  );

  it.each(['sketch', 'wire', 'solid'] as const)(
    'setViewMode changes viewMode to %s',
    (viewMode) => {
      act(() => {
        useEditorViewStore.getState().setViewMode(viewMode);
      });

      expect(useEditorViewStore.getState().viewMode).toBe(viewMode);
    }
  );

  it('setLeftWidth clamps within bounds', () => {
    act(() => {
      useEditorViewStore.getState().setLeftWidth(100);
    });
    expect(useEditorViewStore.getState().layout.leftWidth).toBe(180);

    act(() => {
      useEditorViewStore.getState().setLeftWidth(500);
    });
    expect(useEditorViewStore.getState().layout.leftWidth).toBe(400);

    act(() => {
      useEditorViewStore.getState().setLeftWidth(300);
    });
    expect(useEditorViewStore.getState().layout.leftWidth).toBe(300);
  });

  it('setRightWidth clamps within bounds', () => {
    act(() => {
      useEditorViewStore.getState().setRightWidth(100);
    });
    expect(useEditorViewStore.getState().layout.rightWidth).toBe(220);

    act(() => {
      useEditorViewStore.getState().setRightWidth(600);
    });
    expect(useEditorViewStore.getState().layout.rightWidth).toBe(450);
  });

  it('toggleLeftPanel flips leftCollapsed', () => {
    act(() => {
      useEditorViewStore.getState().toggleLeftPanel();
    });
    expect(useEditorViewStore.getState().layout.leftCollapsed).toBe(true);

    act(() => {
      useEditorViewStore.getState().toggleLeftPanel();
    });
    expect(useEditorViewStore.getState().layout.leftCollapsed).toBe(false);
  });

  it('toggleRightPanel flips rightCollapsed', () => {
    act(() => {
      useEditorViewStore.getState().toggleRightPanel();
    });
    expect(useEditorViewStore.getState().layout.rightCollapsed).toBe(true);
  });

  it('toggleOutputPanel flips outputCollapsed', () => {
    expect(useEditorViewStore.getState().layout.outputCollapsed).toBe(true);

    act(() => {
      useEditorViewStore.getState().toggleOutputPanel();
    });
    expect(useEditorViewStore.getState().layout.outputCollapsed).toBe(false);
  });
});
