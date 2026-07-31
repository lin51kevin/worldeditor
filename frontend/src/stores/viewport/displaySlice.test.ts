import { beforeEach, describe, expect, it } from 'vitest';
import { useViewportStore } from '../viewportStore';

/**
 * Tests for displaySlice toggle visibility branches.
 * The "remove from list" branch is only hit when the ID is already hidden.
 */
describe('displaySlice toggle visibility', () => {
  beforeEach(() => {
    useViewportStore.getState().resetDisplay();
  });

  describe('toggleRoadVisibility', () => {
    it('adds a road to hiddenRoadIds when not present', () => {
      useViewportStore.getState().toggleRoadVisibility('r1');
      expect(useViewportStore.getState().display.hiddenRoadIds).toContain('r1');
    });

    it('removes a road from hiddenRoadIds when already present', () => {
      useViewportStore.getState().toggleRoadVisibility('r1');
      useViewportStore.getState().toggleRoadVisibility('r1'); // toggle off
      expect(useViewportStore.getState().display.hiddenRoadIds).not.toContain('r1');
    });
  });

  describe('toggleJunctionVisibility', () => {
    it('adds a junction to hiddenJunctionIds', () => {
      useViewportStore.getState().toggleJunctionVisibility('j1');
      expect(useViewportStore.getState().display.hiddenJunctionIds).toContain('j1');
    });

    it('removes a junction when already hidden', () => {
      useViewportStore.getState().toggleJunctionVisibility('j1');
      useViewportStore.getState().toggleJunctionVisibility('j1');
      expect(useViewportStore.getState().display.hiddenJunctionIds).not.toContain('j1');
    });
  });

  describe('toggleLaneSectionVisibility', () => {
    it('adds a section key when not hidden', () => {
      useViewportStore.getState().toggleLaneSectionVisibility('r1:0');
      expect(useViewportStore.getState().display.hiddenLaneSectionKeys).toContain('r1:0');
    });

    it('removes a section key when already hidden', () => {
      useViewportStore.getState().toggleLaneSectionVisibility('r1:0');
      useViewportStore.getState().toggleLaneSectionVisibility('r1:0');
      expect(useViewportStore.getState().display.hiddenLaneSectionKeys).not.toContain('r1:0');
    });
  });

  describe('toggleLaneVisibility', () => {
    it('adds a lane key when not hidden', () => {
      useViewportStore.getState().toggleLaneVisibility('r1', 0, 'left', 1);
      const keys = useViewportStore.getState().display.hiddenLaneKeys;
      expect(keys).toHaveLength(1);
    });

    it('removes a lane key when already hidden', () => {
      useViewportStore.getState().toggleLaneVisibility('r1', 0, 'left', 1);
      useViewportStore.getState().toggleLaneVisibility('r1', 0, 'left', 1);
      expect(useViewportStore.getState().display.hiddenLaneKeys).toHaveLength(0);
    });
  });

  describe('toggleSignalVisibility', () => {
    it('adds a signal key when not hidden', () => {
      useViewportStore.getState().toggleSignalVisibility('r1', 's1');
      const keys = useViewportStore.getState().display.hiddenSignalKeys ?? [];
      expect(keys).toHaveLength(1);
    });

    it('removes a signal key when already hidden', () => {
      useViewportStore.getState().toggleSignalVisibility('r1', 's1');
      useViewportStore.getState().toggleSignalVisibility('r1', 's1');
      expect(useViewportStore.getState().display.hiddenSignalKeys ?? []).toHaveLength(0);
    });
  });

  describe('toggleObjectVisibility', () => {
    it('adds an object key when not hidden', () => {
      useViewportStore.getState().toggleObjectVisibility('r1', 'o1');
      const keys = useViewportStore.getState().display.hiddenObjectKeys ?? [];
      expect(keys).toHaveLength(1);
    });

    it('removes an object key when already hidden', () => {
      useViewportStore.getState().toggleObjectVisibility('r1', 'o1');
      useViewportStore.getState().toggleObjectVisibility('r1', 'o1');
      expect(useViewportStore.getState().display.hiddenObjectKeys ?? []).toHaveLength(0);
    });
  });
});
