import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import './i18n';

// Global unhandled Promise rejection handler — surfaces async errors in the console
// (React ErrorBoundary only catches synchronous render errors)
window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[GlobalErrorHandler] Unhandled Promise rejection:', event.reason);
});

// Global synchronous error handler — catches errors outside the React tree
window.addEventListener('error', (event: ErrorEvent) => {
  console.error('[GlobalErrorHandler] Uncaught error:', event.error ?? event.message);
});

// Expose store and services for E2E testing (development only)
if (import.meta.env.DEV) {
  import('./stores/projectStore').then(({ useProjectStore }) => {
    (window as unknown as Record<string, unknown>)['__projectStore'] = useProjectStore;
  });
  import('./stores/viewportStore').then(({ useViewportStore }) => {
    (window as unknown as Record<string, unknown>)['__viewportStore'] = useViewportStore;
  });
  import('./services').then(({ getPlatformService }) => {
    (window as unknown as Record<string, unknown>)['__getPlatformService'] = getPlatformService;
  });
  import('./utils/geometryBuilder').then((mod) => {
    (window as unknown as Record<string, unknown>)['__geometryBuilder'] = mod;
  });
  // Active ViewportRenderer accessor — lets E2E assert that road-surface
  // buffers exist on the first solid frame (no wire→solid toggle needed).
  import('./viewport/viewportRef').then(({ getViewportRenderer }) => {
    (window as unknown as Record<string, unknown>)['__getViewportRenderer'] = getViewportRenderer;
  });
  // Case-actor manual verification: `__caseActors.spawn()` drops sample boxes +
  // a trajectory at the viewport center (switching to 3D) so box rendering and
  // its coexistence with the WASM road surface can be eyeballed; `.clear()`
  // removes them.
  Promise.all([
    import('./viewport/viewportRef'),
    import('./plugins/npc-actors'),
  ]).then(([{ getViewportRenderer }, { spawnSampleActors, clearSampleActors }]) => {
    (window as unknown as Record<string, unknown>)['__caseActors'] = {
      spawn: () => {
        const r = getViewportRenderer();
        if (r) spawnSampleActors(r);
      },
      clear: () => {
        const r = getViewportRenderer();
        if (r) clearSampleActors(r);
      },
    };
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
