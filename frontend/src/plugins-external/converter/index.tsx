/**
 * converter — external batch format conversion plugin (trusted, first-party).
 * Uses registered importers/exporters to chain-convert files.
 */

import { getPluginApi } from '../sdk';
import ConverterPanel from './ConverterPanel';
import { converterCss } from './styles';

const PLUGIN_ID = 'converter';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.injectStyles(converterCss);
  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Batch Converter',
    titleKey: 'panels.batchConverter',
    component: ConverterPanel,
    position: 'right',
  });
});
