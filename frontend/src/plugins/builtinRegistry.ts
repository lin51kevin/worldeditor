/**
 * Built-in plugin registry — static metadata for plugins compiled into the app.
 *
 * Built-ins are always loaded (they mount in App.tsx) and cannot be
 * uninstalled or disabled via the Plugin Manager UI.
 */

import type { PluginInfo } from '../hooks/usePlugins';

export const BUILTIN_PLUGINS: PluginInfo[] = [
  {
    id: 'road-tools',
    name: 'Road Tools',
    version: '1.0.0',
    description: 'Road editing toolbar buttons and Road menu contributions',
    dependencies: [],
    permissions: [],
    status: 'loaded',
    isBuiltin: true,
  },
  {
    id: 'builtin-templates',
    name: 'Built-in Templates',
    version: '1.0.0',
    description: 'Predefined road, junction, signal, and marking templates',
    dependencies: [],
    permissions: [],
    status: 'loaded',
    isBuiltin: true,
  },
];
