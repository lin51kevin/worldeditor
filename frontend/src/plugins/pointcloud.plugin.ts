/** plugin-pointcloud: Point cloud loading and visualization. Desktop only. Stub. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'pointcloud';
export function mountPointcloudPlugin(): () => void {
  const { registerPanel, registerImporter, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({ id: `${PLUGIN_ID}:panel`, pluginId: PLUGIN_ID, title: 'Point Cloud', component: null as never, position: 'left' });
  registerImporter({ id: `${PLUGIN_ID}:importer`, pluginId: PLUGIN_ID, formatName: 'Point Cloud', extensions: ['.las', '.laz', '.pcd', '.ply', '.xyz'], onImport: () => Promise.reject(new Error('Point cloud requires desktop runtime')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
