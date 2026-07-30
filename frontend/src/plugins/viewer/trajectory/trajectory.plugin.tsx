/**
 * plugin-trajectory: trajectory playback UI.
 *
 * Extracts the trajectory feature's always-on UI out of the core app shell into
 * a plugin: the playback bar and the floating scene-config panel (registered as
 * chromeless root widgets). The renderer-coupled playback engine (RAF loop,
 * gaussian-splat actor rendering, chase camera), the trajectory stores, and the
 * File → Import Trajectory entry (an engine entry point, alongside Import Point
 * Cloud / Import OpenDRIVE) remain host infrastructure; this plugin only owns
 * the playback UI surface.
 */

import { usePluginContribStore } from '../../../stores/pluginContribStore';
import { TrajectoryPlaybackBar } from './TrajectoryPlaybackBar';
import { TrajectoryConfigPanel } from './TrajectoryConfigPanel';
import { TrajectoryActorTooltip } from './TrajectoryActorTooltip';
import { TrajectoryStatsHud } from './TrajectoryStatsHud';

const PLUGIN_ID = 'trajectory';

export function mountTrajectoryPlugin(): () => void {
  const { registerRootWidget, unregisterPlugin } = usePluginContribStore.getState();

  registerRootWidget({
    id: `${PLUGIN_ID}:playback-bar`,
    pluginId: PLUGIN_ID,
    component: TrajectoryPlaybackBar,
  });
  registerRootWidget({
    id: `${PLUGIN_ID}:config-panel`,
    pluginId: PLUGIN_ID,
    component: TrajectoryConfigPanel,
  });
  registerRootWidget({
    id: `${PLUGIN_ID}:actor-tooltip`,
    pluginId: PLUGIN_ID,
    component: TrajectoryActorTooltip,
  });
  registerRootWidget({
    id: `${PLUGIN_ID}:stats-hud`,
    pluginId: PLUGIN_ID,
    component: TrajectoryStatsHud,
  });

  return () => unregisterPlugin(PLUGIN_ID);
}
