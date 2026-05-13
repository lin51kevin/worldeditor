/** plugin-pointcloud: Point cloud loading and visualization. Desktop only. Stub. */
import { showAlert } from '../utils/dialog';
import { usePluginContribStore } from '../stores/pluginContribStore';
import { createEmptyProject } from './emptyProject';
const PLUGIN_ID = 'pointcloud';
export function mountPointcloudPlugin(): () => void {
  const { registerPanel, registerImporter, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Point Cloud', component: null as never, position: 'left' });
  // TODO: [Phase 3] 待实现 — implement desktop point cloud import and visualization
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'Point Cloud', extensions: ['.las', '.laz', '.pcd', '.ply', '.xyz'], onImport: async () => { await showAlert('Point cloud import is coming soon (Phase 3).', 'Coming Soon'); return createEmptyProject('Point Cloud Import'); } });
  return () => unregisterPlugin(PLUGIN_ID);
}
