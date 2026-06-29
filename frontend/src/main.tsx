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
