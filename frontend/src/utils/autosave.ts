/**
 * localStorage-backed autosave draft — lets the user recover unsaved work
 * after an accidental close/crash. Stores the raw `Project` alongside a
 * timestamp; all reads are defensive since localStorage content can be
 * corrupted, quota-limited, or written by an older app version.
 */
import type { Project } from '../services/platform';
import { STORAGE_KEYS } from '../constants/storage';

export interface AutosaveDraft {
  project: Project;
  savedAt: string;
}

function isProjectLike(value: unknown): value is Project {
  return !!value && typeof value === 'object' &&
    typeof (value as Project).name === 'string' &&
    Array.isArray((value as Project).roads);
}

export function saveDraft(project: Project): void {
  try {
    const draft: AutosaveDraft = { project, savedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEYS.AUTOSAVE_DRAFT, JSON.stringify(draft));
  } catch (err) {
    console.error('[Autosave] Failed to persist draft:', err);
  }
}

export function loadDraft(): AutosaveDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTOSAVE_DRAFT);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutosaveDraft>;
    if (!isProjectLike(parsed.project) || typeof parsed.savedAt !== 'string') return null;
    return { project: parsed.project, savedAt: parsed.savedAt };
  } catch (err) {
    console.error('[Autosave] Failed to read draft:', err);
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.AUTOSAVE_DRAFT);
  } catch (err) {
    console.error('[Autosave] Failed to clear draft:', err);
  }
}
