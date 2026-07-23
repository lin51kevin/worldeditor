import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useSplineOperations,
  resolveWasmTemplateId,
  finalizeGeometryEditStandalone,
} from './useSplineOperations';
import { useProjectStore } from '../stores/projectStore';
import { useViewportStore } from '../stores/viewportStore';

describe('resolveWasmTemplateId', () => {
  it('maps known panel template ids to WASM template ids', () => {
    expect(resolveWasmTemplateId('tpl:road:single')).toBe('single');
    expect(resolveWasmTemplateId('tpl:road:dual4')).toBe('dual4');
    expect(resolveWasmTemplateId('tpl:road:highway')).toBe('dual6');
    expect(resolveWasmTemplateId('tpl:road:urban')).toBe('dual4');
  });

  it('falls back to the input for unknown ids', () => {
    expect(resolveWasmTemplateId('custom-template')).toBe('custom-template');
  });
});

describe('useSplineOperations.finalizeSplineCreation', () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
  });

  it('does not create a road with fewer than two knots', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useSplineOperations());
    await result.current.finalizeSplineCreation([[0, 0, 0]]);
    expect(useProjectStore.getState().project.roads).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('finalizeGeometryEditStandalone', () => {
  beforeEach(() => {
    useViewportStore.setState({ geometryEditRoadId: null, geometryEditSpline: null });
  });

  it('returns immediately when no geometry edit is active', async () => {
    await expect(finalizeGeometryEditStandalone()).resolves.toBeUndefined();
  });
});
