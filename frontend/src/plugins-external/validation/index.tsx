/**
 * validation — external OpenDRIVE validation panel plugin (trusted, first-party).
 */

import { getPluginApi } from '../sdk';
import { ValidationPanel } from './ValidationPanel';
import { validationCss } from './styles';

const PLUGIN_ID = 'validation';

getPluginApi().registerPlugin(PLUGIN_ID, (ctx) => {
  ctx.injectStyles(validationCss);
  ctx.registerPanel({
    id: `${PLUGIN_ID}:panel`,
    pluginId: PLUGIN_ID,
    title: 'Validation',
    titleKey: 'panels.validation',
    component: ValidationPanel,
    position: 'right',
  });
});
