/**
 * lane-detect — external automated lane detection (beta stub).
 * Hidden in production (beta-gated by the external bootstrap).
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'lane-detect';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerMenuItem({
    id: `${PLUGIN_ID}:detect`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Auto-Detect Lanes',
    labelKey: 'laneDetect.autoDetect',
    onClick: () => { void ctx.ui.alert('Lane detection is coming soon (Phase 3).', 'Coming Soon'); },
  });
});
