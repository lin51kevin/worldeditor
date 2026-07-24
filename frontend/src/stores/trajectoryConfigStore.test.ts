import { describe, it, expect, beforeEach } from 'vitest';
import { useTrajectoryConfigStore } from './trajectoryConfigStore';

function store() {
  return useTrajectoryConfigStore.getState();
}

describe('trajectoryConfigStore', () => {
  beforeEach(() => {
    localStorage.clear();
    store().reset();
  });

  it('maps and clears an actor model', () => {
    store().setActorModel('npc_1', '/models/suv.ply');
    expect(store().actorModels.npc_1).toBe('/models/suv.ply');
    store().setActorModel('npc_1', null);
    expect('npc_1' in store().actorModels).toBe(false);
  });

  it('persists mapping + root to localStorage', () => {
    store().setPlyRoot('/assets/cars');
    store().setActorModel('ego', '/assets/cars/sedan.ply');
    const raw = JSON.parse(localStorage.getItem('we_traj_scene_config') ?? '{}');
    expect(raw.plyRoot).toBe('/assets/cars');
    expect(raw.actorModels.ego).toBe('/assets/cars/sedan.ply');
  });

  it('stores ego and opponent defaults independently', () => {
    store().setDefault('ego', 'a.ply');
    store().setDefault('opponent', 'b.ply');
    expect(store().defaults).toEqual({ ego: 'a.ply', opponent: 'b.ply' });
  });

  it('exports a logsim descriptor with only the set fields', () => {
    store().setPlyRoot('/root');
    store().setActorModel('ego', 'ego.ply');
    store().setScenePly('scene.ply');
    const config = store().exportConfig();
    expect(config).toMatchObject({
      version: 1,
      plyRoot: '/root',
      scenePly: 'scene.ply',
      actorModels: { ego: 'ego.ply' },
    });
    expect(config.defaults).toBeUndefined();
  });

  it('imports a descriptor, replacing the mapping and dropping loaded models', () => {
    store().setActorModel('stale', 'old.ply');
    store().setLoadedModel('stale', { key: 'old.ply', buffer: new Uint32Array(12), shDegree: 0, count: 1 });
    store().importConfig({
      version: 1,
      plyRoot: '/imported',
      actorModels: { ego: 'new.ply', npc_1: 'npc.ply' },
      defaults: { opponent: 'def.ply' },
    });
    const s = store();
    expect(s.plyRoot).toBe('/imported');
    expect(s.actorModels).toEqual({ ego: 'new.ply', npc_1: 'npc.ply' });
    expect(s.defaults.opponent).toBe('def.ply');
    expect(s.loadedModels).toEqual({});
  });

  it('toggles the config panel visibility', () => {
    expect(store().configOpen).toBe(false);
    store().toggleConfigOpen();
    expect(store().configOpen).toBe(true);
    store().toggleConfigOpen(false);
    expect(store().configOpen).toBe(false);
  });

  it('reset clears mapping, scan and loaded models', () => {
    store().setActorModel('ego', 'e.ply');
    store().setScan({ npcs: [{ key: 'e.ply', name: 'e.ply' }], scenes: [], roads: [], trajectories: [] });
    store().setLoadedModel('ego', { key: 'e.ply', buffer: new Uint32Array(12), shDegree: 0, count: 1 });
    store().reset();
    const s = store();
    expect(s.actorModels).toEqual({});
    expect(s.scan).toEqual({ npcs: [], scenes: [], roads: [], trajectories: [] });
    expect(s.loadedModels).toEqual({});
  });
});
