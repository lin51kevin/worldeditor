/** plugin-3d-models: External 3D model loading (OBJ/FBX). Desktop only. Stub. */
import { createElement } from 'react';
import { showAlert } from '../../../utils/dialog';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { createEmptyProject } from '../../core/emptyProject';
const PLUGIN_ID = '3d-models';
const Models3dPanel = () => createElement(
  'div',
  { style: { padding: 12, color: '#8b949e' } },
  '3D model tools are coming soon (Phase 3).',
);
export function mountModels3dPlugin(): () => void {
  const { registerPanel, registerImporter, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: '3D Models', component: Models3dPanel, position: 'left' });
  // TODO: [Phase 3] 待实现 — implement desktop 3D model import integration
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: '3D Model', extensions: ['.obj', '.fbx', '.gltf', '.glb'], onImport: async () => { await showAlert('3D model import is coming soon (Phase 3).', 'Coming Soon'); return createEmptyProject('3D Model Import'); } });
  return () => unregisterPlugin(PLUGIN_ID);
}
