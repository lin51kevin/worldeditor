import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach, test } from 'vitest';
import { DEFAULT_DISPLAY, useEditorViewStore } from './editorViewStore';
import type { EditableSpline, SplineKnot } from '../services/platform';
import { makeSignalKey, makeObjectKey } from '../utils/sceneGraph';

function makeSplineKnot(position: [number, number, number], s: number): SplineKnot {
  return {
    position,
    tangent_in: [0, 0, 0],
    tangent_out: [0, 0, 0],
    s,
    knot_type: 'Key',
    tangent_mode: 'Manual',
  };
}

describe('editorViewStore', () => {
  beforeEach(() => {
    useEditorViewStore.setState({
      dimension: '3d',
      showGrid: true,
      showAxis: true,
      editMode: 'default',
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
        templatePanelCollapsed: false,
      },
      snapEnabled: false,
      snapMode: 'Grid',
      snapThreshold: 5.0,
      gridSnapSize: 1.0,
      measureMode: 'none',
      measurePoints: [],
      lastMeasurement: null,
      softSelectionRadius: 50,
    });
  });

  it('has the expected initial state', () => {
    const state = useEditorViewStore.getState();

    expect(state.dimension).toBe('3d');
    expect(state.showGrid).toBe(true);
    expect(state.showAxis).toBe(true);
    expect(state.editMode).toBe('default');
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

  it.each(['default', 'road', 'lane', 'lanesection', 'spline', 'move-road', 'rotate-road'] as const)(
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

  // --- Soft selection radius ---

  describe('softSelectionRadius', () => {
    it('has a default value of 50', () => {
      useEditorViewStore.setState({ softSelectionRadius: 50 });
      expect(useEditorViewStore.getState().softSelectionRadius).toBe(50);
    });

    it('setSoftSelectionRadius updates the radius', () => {
      act(() => {
        useEditorViewStore.getState().setSoftSelectionRadius(120);
      });
      expect(useEditorViewStore.getState().softSelectionRadius).toBe(120);
    });

    it('setSoftSelectionRadius clamps values below 0.1 to 0.1', () => {
      act(() => {
        useEditorViewStore.getState().setSoftSelectionRadius(-5);
      });
      expect(useEditorViewStore.getState().softSelectionRadius).toBe(0.1);
    });

    it('setSoftSelectionRadius accepts large radii', () => {
      act(() => {
        useEditorViewStore.getState().setSoftSelectionRadius(9999);
      });
      expect(useEditorViewStore.getState().softSelectionRadius).toBe(9999);
    });
  });

  describe('resetDisplay', () => {
    test('clears all hidden arrays', () => {
      useEditorViewStore.setState({
        display: {
          ...DEFAULT_DISPLAY,
          hiddenRoadIds: ['r1'],
          hiddenJunctionIds: ['j1'],
          hiddenLaneSectionKeys: ['k1'],
          hiddenLaneKeys: ['l1'],
          hiddenSignalKeys: ['s1'],
          hiddenObjectKeys: ['o1'],
        }
      });
      useEditorViewStore.getState().resetDisplay();
      const d = useEditorViewStore.getState().display;
      expect(d.hiddenRoadIds).toEqual([]);
      expect(d.hiddenJunctionIds).toEqual([]);
      expect(d.hiddenLaneSectionKeys).toEqual([]);
      expect(d.hiddenLaneKeys).toEqual([]);
      expect(d.hiddenSignalKeys).toEqual([]);
      expect(d.hiddenObjectKeys).toEqual([]);
    });
  });

  describe('spline template and pending', () => {
    it('setSplineTemplateId updates template id', () => {
      act(() => { useEditorViewStore.getState().setSplineTemplateId('my-tpl'); });
      expect(useEditorViewStore.getState().splineTemplateId).toBe('my-tpl');
    });

    it('setPendingTemplate sets pendingTemplateId', () => {
      act(() => { useEditorViewStore.getState().setPendingTemplate('tpl:foo'); });
      expect(useEditorViewStore.getState().pendingTemplateId).toBe('tpl:foo');
    });

    it('clearPendingTemplate clears pendingTemplateId', () => {
      act(() => {
        useEditorViewStore.getState().setPendingTemplate('tpl:foo');
        useEditorViewStore.getState().clearPendingTemplate();
      });
      expect(useEditorViewStore.getState().pendingTemplateId).toBeNull();
    });
  });

  describe('setSplineKnots / setDraggingKnot / setCursorPreviewPos', () => {
    it('setSplineKnots replaces knot array', () => {
      act(() => { useEditorViewStore.getState().setSplineKnots([[1, 2, 0], [3, 4, 0]]); });
      expect(useEditorViewStore.getState().splineKnots).toEqual([[1, 2, 0], [3, 4, 0]]);
    });

    it('setDraggingKnot stores dragging info', () => {
      act(() => { useEditorViewStore.getState().setDraggingKnot({ index: 2, type: 'in' }); });
      expect(useEditorViewStore.getState().draggingKnot).toEqual({ index: 2, type: 'in' });
    });

    it('setDraggingKnot can be cleared with null', () => {
      act(() => {
        useEditorViewStore.getState().setDraggingKnot({ index: 0, type: 'knot' });
        useEditorViewStore.getState().setDraggingKnot(null);
      });
      expect(useEditorViewStore.getState().draggingKnot).toBeNull();
    });

    it('setCursorPreviewPos stores preview position', () => {
      act(() => { useEditorViewStore.getState().setCursorPreviewPos([5, 6, 7]); });
      expect(useEditorViewStore.getState().cursorPreviewPos).toEqual([5, 6, 7]);
    });

    it('setCursorPreviewPos can be cleared', () => {
      act(() => {
        useEditorViewStore.getState().setCursorPreviewPos([5, 6, 7]);
        useEditorViewStore.getState().setCursorPreviewPos(null);
      });
      expect(useEditorViewStore.getState().cursorPreviewPos).toBeNull();
    });
  });

  describe('tangent overrides', () => {
    it('setSplineTangentOverride stores override for index', () => {
      act(() => { useEditorViewStore.getState().setSplineTangentOverride(1, [1, 0, 0]); });
      expect(useEditorViewStore.getState().splineTangentOverrides[1]).toEqual([1, 0, 0]);
    });

    it('setSplineTangentInOverride stores in-tangent override', () => {
      act(() => { useEditorViewStore.getState().setSplineTangentInOverride(2, [0, 1, 0]); });
      expect(useEditorViewStore.getState().splineTangentInOverrides[2]).toEqual([0, 1, 0]);
    });

    it('clearSplineTangentOverrides removes all overrides', () => {
      act(() => {
        useEditorViewStore.getState().setSplineTangentOverride(0, [1, 0, 0]);
        useEditorViewStore.getState().setSplineTangentInOverride(0, [0, 1, 0]);
        useEditorViewStore.getState().clearSplineTangentOverrides();
      });
      expect(useEditorViewStore.getState().splineTangentOverrides).toEqual({});
      expect(useEditorViewStore.getState().splineTangentInOverrides).toEqual({});
    });

    it('setTangentCoupling changes coupling mode', () => {
      act(() => { useEditorViewStore.getState().setTangentCoupling('broken'); });
      expect(useEditorViewStore.getState().tangentCoupling).toBe('broken');
    });
  });

  describe('draw snap actions', () => {
    it('setDrawSnapResult stores result', () => {
      const snap = { x: 1, y: 2, snapped: true, snapType: 'Endpoint' as const, targetId: 'r1', contactPoint: 'start' };
      act(() => { useEditorViewStore.getState().setDrawSnapResult(snap); });
      expect(useEditorViewStore.getState().drawSnapResult).toEqual(snap);
    });

    it('addSnappedEndpoint appends entry', () => {
      act(() => { useEditorViewStore.getState().addSnappedEndpoint({ knotIndex: 0, roadId: 'r1', contactPoint: 'start' }); });
      expect(useEditorViewStore.getState().snappedEndpoints[0]).toEqual({ knotIndex: 0, roadId: 'r1', contactPoint: 'start' });
    });

    it('clearDrawSnap clears drawSnapResult and snappedEndpoints', () => {
      const snap = { x: 1, y: 2, snapped: true, snapType: 'Endpoint' as const, targetId: 'r1', contactPoint: 'start' };
      act(() => {
        useEditorViewStore.getState().setDrawSnapResult(snap);
        useEditorViewStore.getState().addSnappedEndpoint({ knotIndex: 0, roadId: 'r1', contactPoint: 'start' });
        useEditorViewStore.getState().clearDrawSnap();
      });
      expect(useEditorViewStore.getState().drawSnapResult).toBeNull();
      expect(useEditorViewStore.getState().snappedEndpoints).toEqual([]);
    });
  });

  describe('geometry edit actions', () => {
    const sampleSpline: EditableSpline = {
      knots: [makeSplineKnot([0, 0, 0], 0), makeSplineKnot([10, 0, 0], 10)],
    };

    it('enterGeometryEdit stores roadId and spline', () => {
      act(() => { useEditorViewStore.getState().enterGeometryEdit('r1', sampleSpline); });
      expect(useEditorViewStore.getState().geometryEditRoadId).toBe('r1');
      expect(useEditorViewStore.getState().geometryEditSpline).toEqual(sampleSpline);
    });

    it('exitGeometryEdit clears road and spline', () => {
      act(() => {
        useEditorViewStore.getState().enterGeometryEdit('r1', sampleSpline);
        useEditorViewStore.getState().exitGeometryEdit();
      });
      expect(useEditorViewStore.getState().geometryEditRoadId).toBeNull();
      expect(useEditorViewStore.getState().geometryEditSpline).toBeNull();
    });

    it('setGeometryEditSpline updates the spline', () => {
      act(() => {
        useEditorViewStore.getState().enterGeometryEdit('r1', sampleSpline);
        const updated: EditableSpline = {
          knots: [makeSplineKnot([0, 0, 0], 0), makeSplineKnot([5, 0, 0], 5), makeSplineKnot([10, 0, 0], 10)],
        };
        useEditorViewStore.getState().setGeometryEditSpline(updated);
      });
      expect(useEditorViewStore.getState().geometryEditSpline?.knots).toHaveLength(3);
    });
  });

  describe('deprecated draw point actions', () => {
    it('appendDrawPoint appends to splineKnots', () => {
      act(() => { useEditorViewStore.getState().appendDrawPoint([1, 2, 0]); });
      expect(useEditorViewStore.getState().splineKnots).toContainEqual([1, 2, 0]);
    });

    it('clearDrawPoints clears splineKnots', () => {
      act(() => {
        useEditorViewStore.getState().appendDrawPoint([1, 2, 0]);
        useEditorViewStore.getState().clearDrawPoints();
      });
      expect(useEditorViewStore.getState().splineKnots).toEqual([]);
    });
  });

  describe('display settings', () => {
    it('toggleDisplaySetting flips showLaneLines', () => {
      expect(useEditorViewStore.getState().display.showLaneLines).toBe(true);
      act(() => { useEditorViewStore.getState().toggleDisplaySetting('showLaneLines'); });
      expect(useEditorViewStore.getState().display.showLaneLines).toBe(false);
    });

    it('setColorMode changes colorMode', () => {
      act(() => { useEditorViewStore.getState().setColorMode('byRoad'); });
      expect(useEditorViewStore.getState().display.colorMode).toBe('byRoad');
    });

    it('toggleRoadVisibility hides and shows a road', () => {
      act(() => { useEditorViewStore.getState().toggleRoadVisibility('r1'); });
      expect(useEditorViewStore.getState().display.hiddenRoadIds).toContain('r1');
      act(() => { useEditorViewStore.getState().toggleRoadVisibility('r1'); });
      expect(useEditorViewStore.getState().display.hiddenRoadIds).not.toContain('r1');
    });

    it('toggleJunctionVisibility hides a junction', () => {
      act(() => { useEditorViewStore.getState().toggleJunctionVisibility('j1'); });
      expect(useEditorViewStore.getState().display.hiddenJunctionIds).toContain('j1');
    });

    it('toggleSignalVisibility hides a signal', () => {
      act(() => { useEditorViewStore.getState().toggleSignalVisibility('r1', 'sig1'); });
      expect(useEditorViewStore.getState().display.hiddenSignalKeys).toContain(makeSignalKey('r1', 'sig1'));
    });

    it('toggleObjectVisibility hides an object', () => {
      act(() => { useEditorViewStore.getState().toggleObjectVisibility('r1', 'obj1'); });
      expect(useEditorViewStore.getState().display.hiddenObjectKeys).toContain(makeObjectKey('r1', 'obj1'));
    });
  });

  describe('panel layout (additional)', () => {
    it('setOutputHeight clamps between 80 and 300', () => {
      act(() => { useEditorViewStore.getState().setOutputHeight(50); });
      expect(useEditorViewStore.getState().layout.outputHeight).toBe(80);
      act(() => { useEditorViewStore.getState().setOutputHeight(999); });
      expect(useEditorViewStore.getState().layout.outputHeight).toBe(300);
      act(() => { useEditorViewStore.getState().setOutputHeight(200); });
      expect(useEditorViewStore.getState().layout.outputHeight).toBe(200);
    });

    it('toggleTemplatePanel flips templatePanelCollapsed', () => {
      const before = useEditorViewStore.getState().layout.templatePanelCollapsed;
      act(() => { useEditorViewStore.getState().toggleTemplatePanel(); });
      expect(useEditorViewStore.getState().layout.templatePanelCollapsed).toBe(!before);
    });

    it('initLayout loads layout from localStorage (default when empty)', () => {
      act(() => { useEditorViewStore.getState().initLayout(); });
      const layout = useEditorViewStore.getState().layout;
      expect(layout.leftWidth).toBeGreaterThan(0);
    });
  });
});
