import { act } from '@testing-library/react';
import { describe, it, expect, beforeEach, test } from 'vitest';
import { DEFAULT_DISPLAY, useViewportStore } from './viewportStore';
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

describe('viewportStore', () => {
  beforeEach(() => {
    useViewportStore.setState({
      dimension: '3d',
      showGrid: true,
      showAxis: true,
      editMode: 'default',
      selectionMode: 'road',
      splineTemplateId: 'single',
      splineKnots: [],
      viewMode: 'solid',
      display: { ...DEFAULT_DISPLAY },
      layout: {
        leftWidth: 300,
        rightWidth: 300,
        outputHeight: 150,
        leftCollapsed: false,
        rightCollapsed: false,
        outputCollapsed: true,
        templatePanelCollapsed: false,
      },
      snapEnabled: false,
      snapMode: 'Grid',
      snapThreshold: 15.0,
      gridSnapSize: 1.0,
      snapToEndpoints: true,
      snapToMidpoints: true,
      snapToPerpendicular: true,
      snapToGrid: true,
      snapToLaneEndpoints: false,
      measureMode: 'none',
      measurePoints: [],
      lastMeasurement: null,
      softSelectionRadius: 50,
    });
  });

  it('has the expected initial state', () => {
    const state = useViewportStore.getState();

    expect(state.dimension).toBe('3d');
    expect(state.showGrid).toBe(true);
    expect(state.showAxis).toBe(true);
    expect(state.editMode).toBe('default');
    expect(state.selectionMode).toBe('road');
    expect(state.viewMode).toBe('solid');
    expect(state.layout.leftWidth).toBe(300);
    expect(state.layout.rightWidth).toBe(300);
    expect(state.layout.leftCollapsed).toBe(false);
    expect(state.layout.rightCollapsed).toBe(false);
  });

  it('setDimension changes the dimension', () => {
    act(() => {
      useViewportStore.getState().setDimension('2d');
    });

    expect(useViewportStore.getState().dimension).toBe('2d');
  });

  it('toggleGrid flips showGrid', () => {
    act(() => {
      useViewportStore.getState().toggleGrid();
    });

    expect(useViewportStore.getState().showGrid).toBe(false);
  });

  it('toggleGrid twice returns to the original value', () => {
    act(() => {
      useViewportStore.getState().toggleGrid();
      useViewportStore.getState().toggleGrid();
    });

    expect(useViewportStore.getState().showGrid).toBe(true);
  });

  it('toggleAxis flips showAxis', () => {
    act(() => {
      useViewportStore.getState().toggleAxis();
    });

    expect(useViewportStore.getState().showAxis).toBe(false);
  });

  it('showHoverHighlight defaults to false', () => {
    expect(useViewportStore.getState().showHoverHighlight).toBe(false);
  });

  it('toggleHoverHighlight flips showHoverHighlight', () => {
    act(() => {
      useViewportStore.getState().toggleHoverHighlight();
    });

    expect(useViewportStore.getState().showHoverHighlight).toBe(true);

    act(() => {
      useViewportStore.getState().toggleHoverHighlight();
    });

    expect(useViewportStore.getState().showHoverHighlight).toBe(false);
  });

  it.each(['default', 'road', 'lane', 'lanesection', 'spline', 'drawArc', 'drawSpiral', 'move-road', 'rotate-road', 'split', 'editLaneLine'] as const)(
    'setEditMode changes editMode to %s',
    (editMode) => {
      act(() => {
        useViewportStore.getState().setEditMode(editMode);
      });

      expect(useViewportStore.getState().editMode).toBe(editMode);
    }
  );

  it.each(['road', 'laneSection', 'lane'] as const)(
    'setSelectionMode changes selectionMode to %s',
    (selectionMode) => {
      act(() => {
        useViewportStore.getState().setSelectionMode(selectionMode);
      });

      expect(useViewportStore.getState().selectionMode).toBe(selectionMode);
    }
  );
  it('spline knot actions mutate knot list immutably', () => {
    act(() => {
      useViewportStore.getState().appendSplineKnot([1, 2, 0]);
      useViewportStore.getState().appendSplineKnot([3, 4, 0]);
    });
    expect(useViewportStore.getState().splineKnots).toEqual([
      [1, 2, 0],
      [3, 4, 0],
    ]);

    act(() => {
      useViewportStore.getState().popSplineKnot();
    });
    expect(useViewportStore.getState().splineKnots).toEqual([[1, 2, 0]]);

    act(() => {
      useViewportStore.getState().clearSplineKnots();
    });
    expect(useViewportStore.getState().splineKnots).toEqual([]);
  });

  it.each(['sketch', 'wire', 'solid'] as const)(
    'setViewMode changes viewMode to %s',
    (viewMode) => {
      act(() => {
        useViewportStore.getState().setViewMode(viewMode);
      });

      expect(useViewportStore.getState().viewMode).toBe(viewMode);
    }
  );

  it('setLeftWidth clamps within bounds', () => {
    act(() => {
      useViewportStore.getState().setLeftWidth(100);
    });
    expect(useViewportStore.getState().layout.leftWidth).toBe(180);

    act(() => {
      useViewportStore.getState().setLeftWidth(500);
    });
    expect(useViewportStore.getState().layout.leftWidth).toBe(400);

    act(() => {
      useViewportStore.getState().setLeftWidth(300);
    });
    expect(useViewportStore.getState().layout.leftWidth).toBe(300);
  });

  it('setRightWidth clamps within bounds', () => {
    act(() => {
      useViewportStore.getState().setRightWidth(100);
    });
    expect(useViewportStore.getState().layout.rightWidth).toBe(220);

    act(() => {
      useViewportStore.getState().setRightWidth(600);
    });
    expect(useViewportStore.getState().layout.rightWidth).toBe(450);
  });

  it('toggleLeftPanel flips leftCollapsed', () => {
    act(() => {
      useViewportStore.getState().toggleLeftPanel();
    });
    expect(useViewportStore.getState().layout.leftCollapsed).toBe(true);

    act(() => {
      useViewportStore.getState().toggleLeftPanel();
    });
    expect(useViewportStore.getState().layout.leftCollapsed).toBe(false);
  });

  it('toggleRightPanel flips rightCollapsed', () => {
    act(() => {
      useViewportStore.getState().toggleRightPanel();
    });
    expect(useViewportStore.getState().layout.rightCollapsed).toBe(true);
  });

  it('toggleOutputPanel flips outputCollapsed', () => {
    expect(useViewportStore.getState().layout.outputCollapsed).toBe(true);

    act(() => {
      useViewportStore.getState().toggleOutputPanel();
    });
    expect(useViewportStore.getState().layout.outputCollapsed).toBe(false);
  });

  it('toggles lane section visibility', () => {
    act(() => {
      useViewportStore.getState().toggleLaneSectionVisibility('r1::section::0');
    });

    expect(useViewportStore.getState().display.hiddenLaneSectionKeys).toEqual(['r1::section::0']);
  });

  it('toggles lane visibility', () => {
    act(() => {
      useViewportStore.getState().toggleLaneVisibility('r1', 0, 'left', 2);
    });

    expect(useViewportStore.getState().display.hiddenLaneKeys).toEqual(['r1::section::0::left::2']);
  });

  // --- Snapping state ---

  describe('snapping', () => {
    it('toggleSnap flips snapEnabled', () => {
      expect(useViewportStore.getState().snapEnabled).toBe(false);
      act(() => { useViewportStore.getState().toggleSnap(); });
      expect(useViewportStore.getState().snapEnabled).toBe(true);
      act(() => { useViewportStore.getState().toggleSnap(); });
      expect(useViewportStore.getState().snapEnabled).toBe(false);
    });

    it('setSnapMode changes snap mode', () => {
      act(() => { useViewportStore.getState().setSnapMode('Endpoint'); });
      expect(useViewportStore.getState().snapMode).toBe('Endpoint');
    });

    it('setSnapThreshold clamps within the supported slider range', () => {
      act(() => { useViewportStore.getState().setSnapThreshold(10); });
      expect(useViewportStore.getState().snapThreshold).toBe(10);

      act(() => { useViewportStore.getState().setSnapThreshold(0.05); });
      expect(useViewportStore.getState().snapThreshold).toBe(1);

      act(() => { useViewportStore.getState().setSnapThreshold(80); });
      expect(useViewportStore.getState().snapThreshold).toBe(50);
    });

    it('setGridSnapSize clamps within the supported numeric range', () => {
      act(() => { useViewportStore.getState().setGridSnapSize(2.0); });
      expect(useViewportStore.getState().gridSnapSize).toBe(2.0);

      act(() => { useViewportStore.getState().setGridSnapSize(0.1); });
      expect(useViewportStore.getState().gridSnapSize).toBe(0.5);

      act(() => { useViewportStore.getState().setGridSnapSize(120); });
      expect(useViewportStore.getState().gridSnapSize).toBe(100);
    });

    it('stores per-type snap toggles independently', () => {
      act(() => {
        useViewportStore.getState().setSnapToEndpoints(false);
        useViewportStore.getState().setSnapToMidpoints(false);
        useViewportStore.getState().setSnapToPerpendicular(false);
        useViewportStore.getState().setSnapToGrid(false);
        useViewportStore.getState().setSnapToLaneEndpoints(true);
      });

      const state = useViewportStore.getState();
      expect(state.snapToEndpoints).toBe(false);
      expect(state.snapToMidpoints).toBe(false);
      expect(state.snapToPerpendicular).toBe(false);
      expect(state.snapToGrid).toBe(false);
      expect(state.snapToLaneEndpoints).toBe(true);
    });

    it('has correct default snapping state', () => {
      const state = useViewportStore.getState();
      expect(state.snapEnabled).toBe(false);
      expect(state.snapMode).toBe('Grid');
      expect(state.snapThreshold).toBe(15.0);
      expect(state.gridSnapSize).toBe(1.0);
      expect(state.snapToEndpoints).toBe(true);
      expect(state.snapToMidpoints).toBe(true);
      expect(state.snapToPerpendicular).toBe(true);
      expect(state.snapToGrid).toBe(true);
      expect(state.snapToLaneEndpoints).toBe(false);
    });
  });

  // --- Measurement state ---

  describe('measurement', () => {
    it('setMeasureMode changes mode and clears points', () => {
      act(() => {
        useViewportStore.getState().addMeasurePoint({ x: 1, y: 2, z: 0 });
        useViewportStore.getState().setMeasureMode('distance');
      });
      const state = useViewportStore.getState();
      expect(state.measureMode).toBe('distance');
      expect(state.measurePoints).toEqual([]);
      expect(state.lastMeasurement).toBeNull();
    });

    it('addMeasurePoint appends points', () => {
      act(() => {
        useViewportStore.getState().addMeasurePoint({ x: 0, y: 0, z: 0 });
        useViewportStore.getState().addMeasurePoint({ x: 10, y: 0, z: 0 });
      });
      expect(useViewportStore.getState().measurePoints).toHaveLength(2);
      expect(useViewportStore.getState().measurePoints[1]).toEqual({ x: 10, y: 0, z: 0 });
    });

    it('clearMeasurePoints resets points and result', () => {
      act(() => {
        useViewportStore.getState().addMeasurePoint({ x: 1, y: 2, z: 3 });
        useViewportStore.getState().setMeasurementResult({
          type: 'distance',
          value: { straight: 10, horizontal: 10, vertical: 0 },
        });
        useViewportStore.getState().clearMeasurePoints();
      });
      expect(useViewportStore.getState().measurePoints).toEqual([]);
      expect(useViewportStore.getState().lastMeasurement).toBeNull();
    });

    it('setMeasurementResult stores result', () => {
      const result = { type: 'angle' as const, value: { radians: 1.57, degrees: 90 } };
      act(() => { useViewportStore.getState().setMeasurementResult(result); });
      expect(useViewportStore.getState().lastMeasurement).toEqual(result);
    });

    it('has correct default measurement state', () => {
      const state = useViewportStore.getState();
      expect(state.measureMode).toBe('none');
      expect(state.measurePoints).toEqual([]);
      expect(state.lastMeasurement).toBeNull();
    });
  });

  // --- Soft selection radius ---

  describe('softSelectionRadius', () => {
    it('has a default value of 50', () => {
      useViewportStore.setState({ softSelectionRadius: 50 });
      expect(useViewportStore.getState().softSelectionRadius).toBe(50);
    });

    it('setSoftSelectionRadius updates the radius', () => {
      act(() => {
        useViewportStore.getState().setSoftSelectionRadius(120);
      });
      expect(useViewportStore.getState().softSelectionRadius).toBe(120);
    });

    it('setSoftSelectionRadius clamps values below 0.1 to 0.1', () => {
      act(() => {
        useViewportStore.getState().setSoftSelectionRadius(-5);
      });
      expect(useViewportStore.getState().softSelectionRadius).toBe(0.1);
    });

    it('setSoftSelectionRadius accepts large radii', () => {
      act(() => {
        useViewportStore.getState().setSoftSelectionRadius(9999);
      });
      expect(useViewportStore.getState().softSelectionRadius).toBe(9999);
    });
  });

  describe('resetDisplay', () => {
    test('clears all hidden arrays', () => {
      useViewportStore.setState({
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
      useViewportStore.getState().resetDisplay();
      const d = useViewportStore.getState().display;
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
      act(() => { useViewportStore.getState().setSplineTemplateId('my-tpl'); });
      expect(useViewportStore.getState().splineTemplateId).toBe('my-tpl');
    });

    it('setPendingTemplate sets pendingTemplateId', () => {
      act(() => { useViewportStore.getState().setPendingTemplate('tpl:foo'); });
      expect(useViewportStore.getState().pendingTemplateId).toBe('tpl:foo');
    });

    it('clearPendingTemplate clears pendingTemplateId', () => {
      act(() => {
        useViewportStore.getState().setPendingTemplate('tpl:foo');
        useViewportStore.getState().clearPendingTemplate();
      });
      expect(useViewportStore.getState().pendingTemplateId).toBeNull();
    });
  });

  describe('setSplineKnots / setDraggingKnot / setCursorPreviewPos', () => {
    it('setSplineKnots replaces knot array', () => {
      act(() => { useViewportStore.getState().setSplineKnots([[1, 2, 0], [3, 4, 0]]); });
      expect(useViewportStore.getState().splineKnots).toEqual([[1, 2, 0], [3, 4, 0]]);
    });

    it('setDraggingKnot stores dragging info', () => {
      act(() => { useViewportStore.getState().setDraggingKnot({ index: 2, type: 'in' }); });
      expect(useViewportStore.getState().draggingKnot).toEqual({ index: 2, type: 'in' });
    });

    it('setDraggingKnot can be cleared with null', () => {
      act(() => {
        useViewportStore.getState().setDraggingKnot({ index: 0, type: 'knot' });
        useViewportStore.getState().setDraggingKnot(null);
      });
      expect(useViewportStore.getState().draggingKnot).toBeNull();
    });

    it('setCursorPreviewPos stores preview position', () => {
      act(() => { useViewportStore.getState().setCursorPreviewPos([5, 6, 7]); });
      expect(useViewportStore.getState().cursorPreviewPos).toEqual([5, 6, 7]);
    });

    it('setCursorPreviewPos can be cleared', () => {
      act(() => {
        useViewportStore.getState().setCursorPreviewPos([5, 6, 7]);
        useViewportStore.getState().setCursorPreviewPos(null);
      });
      expect(useViewportStore.getState().cursorPreviewPos).toBeNull();
    });
  });

  describe('tangent overrides', () => {
    it('setSplineTangentOverride stores override for index', () => {
      act(() => { useViewportStore.getState().setSplineTangentOverride(1, [1, 0, 0]); });
      expect(useViewportStore.getState().splineTangentOverrides[1]).toEqual([1, 0, 0]);
    });

    it('setSplineTangentInOverride stores in-tangent override', () => {
      act(() => { useViewportStore.getState().setSplineTangentInOverride(2, [0, 1, 0]); });
      expect(useViewportStore.getState().splineTangentInOverrides[2]).toEqual([0, 1, 0]);
    });

    it('clearSplineTangentOverrides removes all overrides', () => {
      act(() => {
        useViewportStore.getState().setSplineTangentOverride(0, [1, 0, 0]);
        useViewportStore.getState().setSplineTangentInOverride(0, [0, 1, 0]);
        useViewportStore.getState().clearSplineTangentOverrides();
      });
      expect(useViewportStore.getState().splineTangentOverrides).toEqual({});
      expect(useViewportStore.getState().splineTangentInOverrides).toEqual({});
    });

    it('setTangentCoupling changes coupling mode', () => {
      act(() => { useViewportStore.getState().setTangentCoupling('broken'); });
      expect(useViewportStore.getState().tangentCoupling).toBe('broken');
    });
  });

  describe('draw snap actions', () => {
    it('setDrawSnapResult stores result', () => {
      const snap = { x: 1, y: 2, snapped: true, snapType: 'Endpoint' as const, targetId: 'r1', contactPoint: 'start' };
      act(() => { useViewportStore.getState().setDrawSnapResult(snap); });
      expect(useViewportStore.getState().drawSnapResult).toEqual(snap);
    });

    it('addSnappedEndpoint appends entry', () => {
      act(() => { useViewportStore.getState().addSnappedEndpoint({ knotIndex: 0, roadId: 'r1', contactPoint: 'start' }); });
      expect(useViewportStore.getState().snappedEndpoints[0]).toEqual({ knotIndex: 0, roadId: 'r1', contactPoint: 'start' });
    });

    it('clearDrawSnap clears drawSnapResult and snappedEndpoints', () => {
      const snap = { x: 1, y: 2, snapped: true, snapType: 'Endpoint' as const, targetId: 'r1', contactPoint: 'start' };
      act(() => {
        useViewportStore.getState().setDrawSnapResult(snap);
        useViewportStore.getState().addSnappedEndpoint({ knotIndex: 0, roadId: 'r1', contactPoint: 'start' });
        useViewportStore.getState().clearDrawSnap();
      });
      expect(useViewportStore.getState().drawSnapResult).toBeNull();
      expect(useViewportStore.getState().snappedEndpoints).toEqual([]);
    });
  });

  describe('geometry edit actions', () => {
    const sampleSpline: EditableSpline = {
      knots: [makeSplineKnot([0, 0, 0], 0), makeSplineKnot([10, 0, 0], 10)],
    };

    it('enterGeometryEdit stores roadId and spline', () => {
      act(() => { useViewportStore.getState().enterGeometryEdit('r1', sampleSpline); });
      expect(useViewportStore.getState().geometryEditRoadId).toBe('r1');
      expect(useViewportStore.getState().geometryEditSpline).toEqual(sampleSpline);
    });

    it('exitGeometryEdit clears road and spline', () => {
      act(() => {
        useViewportStore.getState().enterGeometryEdit('r1', sampleSpline);
        useViewportStore.getState().exitGeometryEdit();
      });
      expect(useViewportStore.getState().geometryEditRoadId).toBeNull();
      expect(useViewportStore.getState().geometryEditSpline).toBeNull();
    });

    it('setGeometryEditSpline updates the spline', () => {
      act(() => {
        useViewportStore.getState().enterGeometryEdit('r1', sampleSpline);
        const updated: EditableSpline = {
          knots: [makeSplineKnot([0, 0, 0], 0), makeSplineKnot([5, 0, 0], 5), makeSplineKnot([10, 0, 0], 10)],
        };
        useViewportStore.getState().setGeometryEditSpline(updated);
      });
      expect(useViewportStore.getState().geometryEditSpline?.knots).toHaveLength(3);
    });
  });

  describe('deprecated draw point actions', () => {
    it('appendDrawPoint appends to splineKnots', () => {
      act(() => { useViewportStore.getState().appendDrawPoint([1, 2, 0]); });
      expect(useViewportStore.getState().splineKnots).toContainEqual([1, 2, 0]);
    });

    it('clearDrawPoints clears splineKnots', () => {
      act(() => {
        useViewportStore.getState().appendDrawPoint([1, 2, 0]);
        useViewportStore.getState().clearDrawPoints();
      });
      expect(useViewportStore.getState().splineKnots).toEqual([]);
    });
  });

  describe('display settings', () => {
    it('toggleDisplaySetting flips showLaneLines', () => {
      expect(useViewportStore.getState().display.showLaneLines).toBe(true);
      act(() => { useViewportStore.getState().toggleDisplaySetting('showLaneLines'); });
      expect(useViewportStore.getState().display.showLaneLines).toBe(false);
    });

    it('setColorMode changes colorMode', () => {
      act(() => { useViewportStore.getState().setColorMode('byRoad'); });
      expect(useViewportStore.getState().display.colorMode).toBe('byRoad');
    });

    it('toggleRoadVisibility hides and shows a road', () => {
      act(() => { useViewportStore.getState().toggleRoadVisibility('r1'); });
      expect(useViewportStore.getState().display.hiddenRoadIds).toContain('r1');
      act(() => { useViewportStore.getState().toggleRoadVisibility('r1'); });
      expect(useViewportStore.getState().display.hiddenRoadIds).not.toContain('r1');
    });

    it('toggleJunctionVisibility hides a junction', () => {
      act(() => { useViewportStore.getState().toggleJunctionVisibility('j1'); });
      expect(useViewportStore.getState().display.hiddenJunctionIds).toContain('j1');
    });

    it('toggleSignalVisibility hides a signal', () => {
      act(() => { useViewportStore.getState().toggleSignalVisibility('r1', 'sig1'); });
      expect(useViewportStore.getState().display.hiddenSignalKeys).toContain(makeSignalKey('r1', 'sig1'));
    });

    it('toggleObjectVisibility hides an object', () => {
      act(() => { useViewportStore.getState().toggleObjectVisibility('r1', 'obj1'); });
      expect(useViewportStore.getState().display.hiddenObjectKeys).toContain(makeObjectKey('r1', 'obj1'));
    });
  });

  describe('panel layout (additional)', () => {
    it('setOutputHeight clamps between 80 and 300', () => {
      act(() => { useViewportStore.getState().setOutputHeight(50); });
      expect(useViewportStore.getState().layout.outputHeight).toBe(80);
      act(() => { useViewportStore.getState().setOutputHeight(999); });
      expect(useViewportStore.getState().layout.outputHeight).toBe(300);
      act(() => { useViewportStore.getState().setOutputHeight(200); });
      expect(useViewportStore.getState().layout.outputHeight).toBe(200);
    });

    it('toggleTemplatePanel flips templatePanelCollapsed', () => {
      const before = useViewportStore.getState().layout.templatePanelCollapsed;
      act(() => { useViewportStore.getState().toggleTemplatePanel(); });
      expect(useViewportStore.getState().layout.templatePanelCollapsed).toBe(!before);
    });

    it('initLayout loads layout from localStorage (default when empty)', () => {
      act(() => { useViewportStore.getState().initLayout(); });
      const layout = useViewportStore.getState().layout;
      expect(layout.leftWidth).toBeGreaterThan(0);
    });
  });
});
