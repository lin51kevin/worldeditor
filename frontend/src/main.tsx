import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import './i18n';

// Expose store and services for E2E testing (development only)
if (import.meta.env.DEV) {
  import('./stores/editorStore').then(({ useEditorStore }) => {
    (window as unknown as Record<string, unknown>)['__editorStore'] = useEditorStore;
  });
  import('./stores/editorViewStore').then(({ useEditorViewStore }) => {
    (window as unknown as Record<string, unknown>)['__editorViewStore'] = useEditorViewStore;
  });
  import('./services').then(({ getPlatformService }) => {
    (window as unknown as Record<string, unknown>)['__getPlatformService'] = getPlatformService;
  });
  import('./utils/geometryBuilder').then((mod) => {
    (window as unknown as Record<string, unknown>)['__geometryBuilder'] = mod;
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
