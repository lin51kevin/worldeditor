/** plugin-lane-detect: Automated lane detection from point cloud / satellite. Stub. */
import { usePluginContribStore } from '../stores/pluginContribStore';
const PLUGIN_ID = 'lane-detect';
export function mountLaneDetectPlugin(): () => void {
  const { registerMenuItem, unregisterPlugin } = usePluginContribStore.getState();
  // TODO: [Phase 3] 待实现 — implement automated lane detection workflow
  registerMenuItem({ id: `${PLUGIN_ID}:detect`, pluginId: PLUGIN_ID, menu: 'tools', label: 'Auto-Detect Lanes', labelKey: 'laneDetect.autoDetect', onClick: () => Promise.reject(new Error('Lane detection requires Phase 3')) });
  return () => unregisterPlugin(PLUGIN_ID);
}
