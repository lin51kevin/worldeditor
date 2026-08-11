import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../services/platform';
import { STORAGE_KEYS } from '../constants/storage';
import { saveDraft, loadDraft, clearDraft } from './autosave';

function makeProject(name = 'Untitled'): Project {
  return {
    name,
    header: {
      rev_major: 1, rev_minor: 6, name: '', date: '',
      north: 0, south: 0, east: 0, west: 0, geo_reference: null,
    },
    roads: [],
    junctions: [],
    signals: [],
    objects: [],
  };
}

describe('autosave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('loadDraft returns null when nothing is stored', () => {
    expect(loadDraft()).toBeNull();
  });

  it('saveDraft then loadDraft round-trips the project', () => {
    const project = makeProject('MyRoad');
    saveDraft(project);
    const draft = loadDraft();
    expect(draft).not.toBeNull();
    expect(draft?.project).toEqual(project);
    expect(typeof draft?.savedAt).toBe('string');
  });

  it('clearDraft removes the stored draft', () => {
    saveDraft(makeProject());
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('loadDraft returns null for corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEYS.AUTOSAVE_DRAFT, '{not valid json');
    expect(loadDraft()).toBeNull();
  });

  it('loadDraft returns null when the stored shape is missing required fields', () => {
    localStorage.setItem(STORAGE_KEYS.AUTOSAVE_DRAFT, JSON.stringify({ foo: 'bar' }));
    expect(loadDraft()).toBeNull();
  });

  it('saveDraft swallows and logs localStorage errors', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => saveDraft(makeProject())).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});
