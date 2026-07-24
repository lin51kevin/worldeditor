/**
 * PluginRootWidgets — renders plugin-contributed chromeless root widgets.
 *
 * Unlike {@link PluginPanels} (each wrapped in titled floating-panel chrome),
 * root widgets are rendered directly at the application root, always-on. The
 * widget component manages its own visibility and positioning (e.g. the
 * trajectory playback bar that returns null when no trajectory is loaded).
 */

import { usePluginContribStore } from '../../stores/pluginContribStore';

export function PluginRootWidgets() {
  const rootWidgets = usePluginContribStore((s) => s.rootWidgets);

  return (
    <>
      {rootWidgets.map((widget) => {
        const Component = widget.component;
        return <Component key={widget.id} />;
      })}
    </>
  );
}
