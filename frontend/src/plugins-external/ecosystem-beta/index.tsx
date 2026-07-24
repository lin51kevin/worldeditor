/**
 * ecosystem-beta — external vegetation/tree placement panel (beta stub).
 * Hidden in production (beta-gated by the external bootstrap).
 */

import { getPluginApi } from '../sdk';

const PLUGIN_ID = 'ecosystem-beta';

function EcosystemPanel() {
  return <div style={{ padding: 12, color: '#8b949e' }}>Ecosystem tools are coming soon (Phase 3).</div>;
}

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Ecosystem',
    component: EcosystemPanel,
    position: 'left',
  });
  ctx.registerMenuItem({
    id: `${PLUGIN_ID}:place-trees`,
    pluginId: PLUGIN_ID,
    menu: 'tools',
    label: 'Place Trees',
    labelKey: 'ecosystem.placeTrees',
    onClick: () => { void ctx.ui.alert('Ecosystem tools are coming soon (Phase 3).', 'Coming Soon'); },
  });
});
