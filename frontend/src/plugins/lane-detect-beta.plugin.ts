/** plugin-lane-detect: Automated lane detection from point cloud / satellite. Stub. */
import { showAlert } from '../utils/dialog';
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'lane-detect';
export function mountLaneDetectPlugin(): () => void {
  const { registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  // TODO: [Phase 3] 待实现 — implement automated lane detection workflow
  registerMenuItem({ id: `${PLUGIN_ID}:detect`, pluginId: PLUGIN_ID, menu: 'tools', label: 'Auto-Detect Lanes', labelKey: 'laneDetect.autoDetect', onClick: () => { void showAlert('Lane detection is coming soon (Phase 3).', 'Coming Soon'); } });
  return () => unregisterPlugin(PLUGIN_ID);
}
