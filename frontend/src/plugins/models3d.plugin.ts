/** plugin-3d-models: External 3D model loading (OBJ/FBX). Desktop only. Stub. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = '3d-models';
export function mountModels3dPlugin(): () => void {
  const { registerPanel, registerImporter, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: '3D Models', component: null as never, position: 'left' });
  // TODO: [Phase 3] 待实现 — implement desktop 3D model import integration
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: '3D Model', extensions: ['.obj', '.fbx', '.gltf', '.glb'], onImport: () => Promise.reject(new Error('3D model import requires desktop runtime')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
