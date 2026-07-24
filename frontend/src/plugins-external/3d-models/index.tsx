/**
 * 3d-models — external 3D model import panel (beta stub).
 * Hidden in production (beta-gated by the external bootstrap).
 */

import { getPluginApi } from '../sdk';
import { createEmptyProject } from '../../plugins/core/emptyProject';

const PLUGIN_ID = '3d-models';

function Models3dPanel() {
  return <div style={{ padding: 12, color: '#8b949e' }}>3D model tools are coming soon (Phase 3).</div>;
}

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: '3D Models',
    component: Models3dPanel,
    position: 'left',
  });
  ctx.registerImporter({
    id: `${PLUGIN_ID}:importer`,
    pluginId: PLUGIN_ID,
    formatName: '3D Model',
    extensions: ['.obj', '.fbx', '.gltf', '.glb'],
    onImport: async () => {
      await ctx.ui.alert('3D model import is coming soon (Phase 3).', 'Coming Soon');
      return createEmptyProject('3D Model Import');
    },
  });
});
