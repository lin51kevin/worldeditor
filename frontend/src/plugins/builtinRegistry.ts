/**
 * Built-in plugin registry — static metadata and mount functions for plugins compiled into the app.
 *
 * Built-ins are always loaded (they mount in App.tsx) and cannot be
 * uninstalled or disabled via the Plugin Manager UI.
 */

import type { PluginInfo } from '../hooks/usePlugins';
import { mountRoadToolsPlugin } from './editing/road-tools/road-tools.plugin';
import { mountTemplatesPlugin } from './editing/templates/templates.plugin';
import { mountAdvancedEditingPlugin } from './editing/advanced-editing/advanced-editing.plugin';
import { mountShapeEditorPlugin } from './editing/shape-editor/shape-editor.plugin';
import { mountConverterPlugin } from './editing/converter/converter.plugin';
import { mountAiCopilotPlugin } from './editing/ai-copilot/ai-copilot.plugin';
import { mountIoCsvPlugin } from './io/csv/io-csv.plugin';
import { mountIoObj3dPlugin } from './io/obj3d/io-obj3d.plugin';
import { mountIoGeoZPlugin } from './io/geoz/io-geoz.plugin';
import { mountIoOsmPlugin } from './io/osm/io-osm.plugin';
import { mountIoSignalsPlugin } from './io/signals/io-signals.plugin';
import { mountIoLanelet2Plugin } from './io/lanelet2/io-lanelet2.plugin';
import { mountIoShapefilePlugin } from './io/shapefile/io-shapefile.plugin';
import { mountIoDxfPlugin } from './io/dxf/io-dxf.plugin';
import { mountIoNioPlugin } from './io/nio/io-nio.plugin';
import { mountIoMifPlugin } from './io/mif/io-mif.plugin';
import { mountIoXodrExtPlugin } from './io/xodr-ext/io-xodr-ext.plugin';
import { mountValidationPlugin } from './analysis/validation/validation.plugin';
import { mountTrafficPlugin } from './analysis/traffic/traffic.plugin';
import { mountLaneDetectPlugin } from './analysis/lane-detect/lane-detect-beta.plugin';
import { mountGisToolsPlugin } from './gis-viz/gis-tools/gis-tools.plugin';
import { mountPointcloudPlugin } from './gis-viz/pointcloud/pointcloud-beta.plugin';
import { mountSatellitePlugin } from './gis-viz/satellite/satellite-beta.plugin';
import { mountModels3dPlugin } from './gis-viz/models-3d/models-3d-beta.plugin';
import { mountScriptingPlugin } from './gis-viz/scripting/scripting-beta.plugin';
import { mountEcosystemPlugin } from './gis-viz/ecosystem/ecosystem-beta.plugin';

/** Plugin entry with a mount function for App.tsx registration. */
export interface BuiltinPluginEntry extends PluginInfo {
  /** Mount the plugin — returns a cleanup function. */
  mount: () => () => void;
}

/** Mount functions keyed by plugin id for lookup. */
const MOUNT_MAP: Record<string, () => () => void> = {
  'road-tools': mountRoadToolsPlugin,
  'builtin-templates': mountTemplatesPlugin,
  'advanced-editing': mountAdvancedEditingPlugin,
  'shape-editor': mountShapeEditorPlugin,
  'io-csv-import': mountIoCsvPlugin,
  'io-obj3d-export': mountIoObj3dPlugin,
  'io-lanelet2': mountIoLanelet2Plugin,
  'io-shapefile': mountIoShapefilePlugin,
  'io-dxf': mountIoDxfPlugin,
  'io-nio': mountIoNioPlugin,
  'io-geoz-import': mountIoGeoZPlugin,
  'io-mif': mountIoMifPlugin,
  'io-osm-export': mountIoOsmPlugin,
  'io-signals': mountIoSignalsPlugin,
  'io-xodr-ext': mountIoXodrExtPlugin,
  'gis-tools': mountGisToolsPlugin,
  'validation': mountValidationPlugin,
  'traffic': mountTrafficPlugin,
  'pointcloud-beta': mountPointcloudPlugin,
  'satellite-beta': mountSatellitePlugin,
  '3d-models': mountModels3dPlugin,
  'scripting-beta': mountScriptingPlugin,
  'ecosystem-beta': mountEcosystemPlugin,
  'lane-detect': mountLaneDetectPlugin,
  'converter': mountConverterPlugin,
  'ai-copilot': mountAiCopilotPlugin,
};

/** Static metadata for all built-in plugins. */
const BUILTIN_META: PluginInfo[] = [
  {
    id: 'road-tools',
    name: 'Road Tools',
    nameKey: 'pluginManager.builtinRoadToolsName',
    version: '1.0.0',
    description: 'Road editing toolbar buttons and Road menu contributions',
    descriptionKey: 'pluginManager.builtinRoadToolsDesc',
    dependencies: [],
    permissions: [],
    status: 'loaded',
    isBuiltin: true,
  },
  {
    id: 'builtin-templates',
    name: 'Built-in Templates',
    nameKey: 'pluginManager.builtinTemplatesName',
    version: '1.0.0',
    description: 'Predefined road, junction, signal, and marking templates',
    descriptionKey: 'pluginManager.builtinTemplatesDesc',
    dependencies: [],
    permissions: [],
    status: 'loaded',
    isBuiltin: true,
  },
  {
    id: 'advanced-editing',
    name: 'Advanced Editing',
    nameKey: 'pluginManager.builtinAdvancedEditingName',
    version: '1.0.0',
    description: 'Advanced road/lane/junction editing operations with undo/redo support',
    descriptionKey: 'pluginManager.builtinAdvancedEditingDesc',
    dependencies: [],
    permissions: [],
    status: 'loaded',
    isBuiltin: true,
  },
  { id: 'io-csv-import', name: 'CSV I/O', nameKey: 'pluginManager.builtinIoCsvName', version: '1.0.0', description: 'Import/export roads as CSV', descriptionKey: 'pluginManager.builtinIoCsvDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-obj3d-export', name: 'OBJ 3D Export', nameKey: 'pluginManager.builtinIoObj3dName', version: '1.0.0', description: 'Export 3D road mesh as OBJ', descriptionKey: 'pluginManager.builtinIoObj3dDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-lanelet2', name: 'Lanelet2 I/O', nameKey: 'pluginManager.builtinIoLanelet2Name', version: '1.0.0', description: 'Import/export Lanelet2 HD maps (OSM-XML)', descriptionKey: 'pluginManager.builtinIoLanelet2Desc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-shapefile', name: 'Shapefile I/O', nameKey: 'pluginManager.builtinIoShapefileName', version: '1.0.0', description: 'Import/export single-file Shapefile bundles', descriptionKey: 'pluginManager.builtinIoShapefileDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-dxf', name: 'DXF I/O', nameKey: 'pluginManager.builtinIoDxfName', version: '1.0.0', description: 'Import/export AutoCAD DXF centerlines', descriptionKey: 'pluginManager.builtinIoDxfDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-nio', name: 'NIO I/O', nameKey: 'pluginManager.builtinIoNioName', version: '1.0.0', description: 'Import/export NIO binary maps', descriptionKey: 'pluginManager.builtinIoNioDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-geoz-import', name: 'GeoZ Map I/O', version: '0.2.0', description: 'Import and export GeoZ format map files (ZIP + protobuf)', author: 'WorldEditor', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-mif', name: 'MIF/MID I/O', nameKey: 'pluginManager.builtinIoMifName', version: '1.0.0', description: 'Import/export MapInfo MIF geometry', descriptionKey: 'pluginManager.builtinIoMifDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-osm-export', name: 'OSM Export', nameKey: 'pluginManager.builtinIoOsmName', version: '1.0.0', description: 'Export roads as OpenStreetMap XML', descriptionKey: 'pluginManager.builtinIoOsmDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-signals', name: 'Signal JSON I/O', nameKey: 'pluginManager.builtinIoSignalsName', version: '1.0.0', description: 'Import signal JSON / export HD Map XML', descriptionKey: 'pluginManager.builtinIoSignalsDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-xodr-ext', name: 'OpenDRIVE Extensions', nameKey: 'pluginManager.builtinIoXodrExtName', version: '1.0.0', description: 'OpenDRIVE extended import with version migration', descriptionKey: 'pluginManager.builtinIoXodrExtDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'gis-tools', name: 'GIS Tools', nameKey: 'pluginManager.builtinGisToolsName', version: '1.0.0', description: 'Advanced GIS coordinate systems panel', descriptionKey: 'pluginManager.builtinGisToolsDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'validation', name: 'Validation', nameKey: 'pluginManager.builtinValidationName', version: '1.0.0', description: 'OpenDRIVE data quality and topology validation', descriptionKey: 'pluginManager.builtinValidationDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'traffic', name: 'Traffic', nameKey: 'pluginManager.builtinTrafficName', version: '1.0.0', description: 'Signal phasing, timing editor, SUMO I/O', descriptionKey: 'pluginManager.builtinTrafficDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'pointcloud-beta', name: 'Point Cloud', nameKey: 'pluginManager.builtinPointcloudName', version: '1.0.0', description: 'Point cloud loading and visualization (desktop only)', descriptionKey: 'pluginManager.builtinPointcloudDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'satellite-beta', name: 'Satellite', nameKey: 'pluginManager.builtinSatelliteName', version: '1.0.0', description: 'OSM tiles and satellite imagery overlay (desktop only)', descriptionKey: 'pluginManager.builtinSatelliteDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: '3d-models', name: '3D Models', nameKey: 'pluginManager.builtin3dModelsName', version: '1.0.0', description: 'External 3D model loading OBJ/FBX (desktop only)', descriptionKey: 'pluginManager.builtin3dModelsDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'scripting-beta', name: 'Scripting', nameKey: 'pluginManager.builtinScriptingName', version: '1.0.0', description: 'Embedded Rhai script console', descriptionKey: 'pluginManager.builtinScriptingDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'ecosystem-beta', name: 'Ecosystem', nameKey: 'pluginManager.builtinEcosystemName', version: '1.0.0', description: 'Vegetation and tree placement panel', descriptionKey: 'pluginManager.builtinEcosystemDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'lane-detect', name: 'Lane Detection', nameKey: 'pluginManager.builtinLaneDetectName', version: '1.0.0', description: 'Automated lane detection (Phase 3)', descriptionKey: 'pluginManager.builtinLaneDetectDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'converter', name: 'Batch Converter', nameKey: 'pluginManager.builtinConverterName', version: '1.0.0', description: 'Batch format conversion panel', descriptionKey: 'pluginManager.builtinConverterDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'ai-copilot', name: 'AI Copilot', nameKey: 'pluginManager.builtinAiCopilotName', version: '1.0.0', description: 'AI assistant panel for road editing', descriptionKey: 'pluginManager.builtinAiCopilotDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'shape-editor', name: 'Shape Editor', nameKey: 'pluginManager.builtinShapeEditorName', version: '1.0.0', description: 'Vector shape layer editor for pre-road geometry construction', descriptionKey: 'pluginManager.builtinShapeEditorDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
];

/**
 * Beta / experimental plugins. Excluded from the registry in production builds,
 * so they are neither listed in the Plugin Manager nor mounted. They remain
 * available in dev and test builds, or in production when
 * `VITE_SHOW_BETA_PLUGINS=true` is set.
 */
const BETA_PLUGIN_IDS = new Set<string>([
  'lane-detect',
  'satellite-beta',
  '3d-models',
  'scripting-beta',
  'ecosystem-beta',
]);

/** Whether beta plugins should be included in this build. */
const BETA_PLUGINS_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_BETA_PLUGINS === 'true';

/** Builtin plugins with mount functions attached (beta plugins hidden in production). */
export const BUILTIN_PLUGINS: BuiltinPluginEntry[] = BUILTIN_META.filter(
  (meta) => BETA_PLUGINS_ENABLED || !BETA_PLUGIN_IDS.has(meta.id),
).map((meta) => ({
  ...meta,
  mount: MOUNT_MAP[meta.id] ?? (() => () => {}),
}));
