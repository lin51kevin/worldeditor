import { useEffect } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { saveDraft, clearDraft } from '../utils/autosave';

const AUTOSAVE_DEBOUNCE_MS = 2000;

/**
 * Debounced localStorage autosave: persists a recovery draft while the
 * project is dirty (clearing it once the project is saved/reset), and warns
 * the browser before the user navigates away with unsaved changes. Mount
 * once near the app root.
 */
export function useAutosave(): void {
  const project = useProjectStore((s) => s.project);
  const isDirty = useProjectStore((s) => s.isDirty);

  useEffect(() => {
    if (!isDirty) {
      clearDraft();
      return;
    }
    const timer = setTimeout(() => saveDraft(project), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [project, isDirty]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!useProjectStore.getState().isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);
}
