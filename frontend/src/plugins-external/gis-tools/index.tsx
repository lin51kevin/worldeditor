/**
 * gis-tools — external advanced GIS coordinate-system panel.
 *
 * Registers a right-side panel whose coordinate conversions are backed by the
 * host WASM engine (ctx.gis). Rendered with the host's shared React instance.
 */

import { getPluginApi } from '../sdk';
import { createGisToolsPanel } from './GisToolsPanel';
import { gisToolsCss } from './styles';

const PLUGIN_ID = 'gis-tools';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.injectStyles(gisToolsCss);
  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'GIS Tools',
    titleKey: 'panels.gisTools',
    component: createGisToolsPanel(ctx.gis),
    position: 'right',
  });
});
