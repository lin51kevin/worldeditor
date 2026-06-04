/** plugin-pointcloud: Point cloud → vector workflow (load, ground/marking
 *  extraction, vectorize to roads). Desktop supports LAS/LAZ/PCD/PLY/XYZ; web
 *  supports PCD/PLY/XYZ. */
import PointCloudPanel from './PointCloudPanel';
import { usePluginContribStore } from '../../../stores/pluginContribStore';

const PLUGIN_ID = 'pointcloud-beta';

export function mountPointcloudPlugin(): () => void {
  const { registerPanel, unregisterPlugin } = usePluginContribStore.getState();
  registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Point Cloud',
    titleKey: 'panels.pointcloud',
    component: PointCloudPanel,
    position: 'left',
  });
  return () => unregisterPlugin(PLUGIN_ID);
}

