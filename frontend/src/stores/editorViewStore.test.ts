import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULT_DISPLAY, useEditorViewStore } from './editorViewStore';

describe('editorViewStore', () => {
  beforeEach(() => {
    useEditorViewStore.setState({
      dimension: '3d',
      showGrid: true,
      showAxis: true,
      editMode: 'select',
      splineTemplateId: 'single',
      splineKnots: [],
      viewMode: 'solid',
      display: { ...DEFAULT_DISPLAY },
      layout: {
        leftWidth: 260,
        rightWidth: 300,
        outputHeight: 150,
        leftCollapsed: false,
        rightCollapsed: false,
        outputCollapsed: true,
      },
      snapEnabled: false,
      snapMode: 'Grid',
      snapThreshold: 5.0,
      gridSnapSize: 1.0,
      measureMode: 'none',
      measurePoints: [],
      lastMeasurement: null,
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

  it.each(['select', 'road', 'lane', 'junction', 'spline'] as const)(
    'setEditMode changes editMode to %s',
    (editMode) => {
      act(() => {
        useEditorViewStore.getState().setEditMode(editMode);
      });

      expect(useEditorViewStore.getState().editMode).toBe(editMode);
    }
  );

  it('spline knot actions mutate knot list immutably', () => {
    act(() => {
      useEditorViewStore.getState().appendSplineKnot([1, 2, 0]);
      useEditorViewStore.getState().appendSplineKnot([3, 4, 0]);
    });
    expect(useEditorViewStore.getState().splineKnots).toEqual([
      [1, 2, 0],
      [3, 4, 0],
    ]);

    act(() => {
      useEditorViewStore.getState().popSplineKnot();
    });
    expect(useEditorViewStore.getState().splineKnots).toEqual([[1, 2, 0]]);

    act(() => {
      useEditorViewStore.getState().clearSplineKnots();
    });
    expect(useEditorViewStore.getState().splineKnots).toEqual([]);
  });

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

  it('toggles lane section visibility', () => {
    act(() => {
      useEditorViewStore.getState().toggleLaneSectionVisibility('r1::section::0');
    });

    expect(useEditorViewStore.getState().display.hiddenLaneSectionKeys).toEqual(['r1::section::0']);
  });

  it('toggles lane visibility', () => {
    act(() => {
      useEditorViewStore.getState().toggleLaneVisibility('r1', 0, 'left', 2);
    });

    expect(useEditorViewStore.getState().display.hiddenLaneKeys).toEqual(['r1::section::0::left::2']);
  });

  // --- Snapping state ---

  describe('snapping', () => {
    it('toggleSnap flips snapEnabled', () => {
      expect(useEditorViewStore.getState().snapEnabled).toBe(false);
      act(() => { useEditorViewStore.getState().toggleSnap(); });
      expect(useEditorViewStore.getState().snapEnabled).toBe(true);
      act(() => { useEditorViewStore.getState().toggleSnap(); });
      expect(useEditorViewStore.getState().snapEnabled).toBe(false);
    });

    it('setSnapMode changes snap mode', () => {
      act(() => { useEditorViewStore.getState().setSnapMode('Endpoint'); });
      expect(useEditorViewStore.getState().snapMode).toBe('Endpoint');
    });

    it('setSnapThreshold clamps to minimum 0.1', () => {
      act(() => { useEditorViewStore.getState().setSnapThreshold(10); });
      expect(useEditorViewStore.getState().snapThreshold).toBe(10);

      act(() => { useEditorViewStore.getState().setSnapThreshold(0.05); });
      expect(useEditorViewStore.getState().snapThreshold).toBe(0.1);
    });

    it('setGridSnapSize clamps to minimum 0.01', () => {
      act(() => { useEditorViewStore.getState().setGridSnapSize(2.0); });
      expect(useEditorViewStore.getState().gridSnapSize).toBe(2.0);

      act(() => { useEditorViewStore.getState().setGridSnapSize(0.001); });
      expect(useEditorViewStore.getState().gridSnapSize).toBe(0.01);
    });

    it('has correct default snapping state', () => {
      const state = useEditorViewStore.getState();
      expect(state.snapEnabled).toBe(false);
      expect(state.snapMode).toBe('Grid');
      expect(state.snapThreshold).toBe(5.0);
      expect(state.gridSnapSize).toBe(1.0);
    });
  });

  // --- Measurement state ---

  describe('measurement', () => {
    it('setMeasureMode changes mode and clears points', () => {
      act(() => {
        useEditorViewStore.getState().addMeasurePoint({ x: 1, y: 2, z: 0 });
        useEditorViewStore.getState().setMeasureMode('distance');
      });
      const state = useEditorViewStore.getState();
      expect(state.measureMode).toBe('distance');
      expect(state.measurePoints).toEqual([]);
      expect(state.lastMeasurement).toBeNull();
    });

    it('addMeasurePoint appends points', () => {
      act(() => {
        useEditorViewStore.getState().addMeasurePoint({ x: 0, y: 0, z: 0 });
        useEditorViewStore.getState().addMeasurePoint({ x: 10, y: 0, z: 0 });
      });
      expect(useEditorViewStore.getState().measurePoints).toHaveLength(2);
      expect(useEditorViewStore.getState().measurePoints[1]).toEqual({ x: 10, y: 0, z: 0 });
    });

    it('clearMeasurePoints resets points and result', () => {
      act(() => {
        useEditorViewStore.getState().addMeasurePoint({ x: 1, y: 2, z: 3 });
        useEditorViewStore.getState().setMeasurementResult({
          type: 'distance',
          value: { straight: 10, horizontal: 10, vertical: 0 },
        });
        useEditorViewStore.getState().clearMeasurePoints();
      });
      expect(useEditorViewStore.getState().measurePoints).toEqual([]);
      expect(useEditorViewStore.getState().lastMeasurement).toBeNull();
    });

    it('setMeasurementResult stores result', () => {
      const result = { type: 'angle' as const, value: { radians: 1.57, degrees: 90 } };
      act(() => { useEditorViewStore.getState().setMeasurementResult(result); });
      expect(useEditorViewStore.getState().lastMeasurement).toEqual(result);
    });

    it('has correct default measurement state', () => {
      const state = useEditorViewStore.getState();
      expect(state.measureMode).toBe('none');
      expect(state.measurePoints).toEqual([]);
      expect(state.lastMeasurement).toBeNull();
    });
  });
});
