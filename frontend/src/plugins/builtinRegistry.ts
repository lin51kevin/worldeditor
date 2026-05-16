/**
 * Built-in plugin registry — static metadata and mount functions for plugins compiled into the app.
 *
 * Built-ins are always loaded (they mount in App.tsx) and cannot be
 * uninstalled or disabled via the Plugin Manager UI.
 */

import type { PluginInfo } from '../hooks/usePlugins';
import { mountRoadToolsPlugin } from './roadTools.plugin';
import { mountTemplatesPlugin } from './templates.plugin';
import { mountAdvancedEditingPlugin } from './advancedEditing.plugin';
import { mountIoCsvPlugin } from './ioCsv.plugin';
import { mountIoObj3dPlugin } from './ioObj3d.plugin';
import { mountIoLanelet2Plugin } from './io-lanelet2-stub.plugin';
import { mountIoShapefilePlugin } from './io-shapefile-stub.plugin';
import { mountIoDxfPlugin } from './io-dxf-stub.plugin';
import { mountIoNioPlugin } from './io-nio-stub.plugin';
import { mountIoGeoZPlugin } from './ioGeoZ.plugin';
import { mountIoMifPlugin } from './io-mif-stub.plugin';
import { mountIoOsmPlugin } from './ioOsm.plugin';
import { mountIoSignalsPlugin } from './ioSignals.plugin';
import { mountIoXodrExtPlugin } from './io-xodr-ext-stub.plugin';
import { mountGisToolsPlugin } from './gisTools.plugin';
import { mountValidationPlugin } from './validation.plugin';
import { mountTrafficPlugin } from './traffic.plugin';
import { mountPointcloudPlugin } from './pointcloud-beta.plugin';
import { mountSatellitePlugin } from './satellite-beta.plugin';
import { mountModels3dPlugin } from './models-3d-beta.plugin';
import { mountScriptingPlugin } from './scripting-beta.plugin';
import { mountEcosystemPlugin } from './ecosystem-beta.plugin';
import { mountLaneDetectPlugin } from './lane-detect-beta.plugin';
import { mountConverterPlugin } from './converter.plugin';

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
  'io-csv-import': mountIoCsvPlugin,
  'io-obj3d-export': mountIoObj3dPlugin,
  'io-lanelet2-stub': mountIoLanelet2Plugin,
  'io-shapefile-stub': mountIoShapefilePlugin,
  'io-dxf-stub': mountIoDxfPlugin,
  'io-nio-stub': mountIoNioPlugin,
  'io-geoz-import': mountIoGeoZPlugin,
  'io-mif-stub': mountIoMifPlugin,
  'io-osm-export': mountIoOsmPlugin,
  'io-signals': mountIoSignalsPlugin,
  'io-xodr-ext-stub': mountIoXodrExtPlugin,
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
  { id: 'io-lanelet2-stub', name: 'Lanelet2 I/O', nameKey: 'pluginManager.builtinIoLanelet2Name', version: '1.0.0', description: 'Import/export Lanelet2 HD maps', descriptionKey: 'pluginManager.builtinIoLanelet2Desc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-shapefile-stub', name: 'Shapefile I/O', nameKey: 'pluginManager.builtinIoShapefileName', version: '1.0.0', description: 'Import/export Shapefile format (Phase 3)', descriptionKey: 'pluginManager.builtinIoShapefileDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-dxf-stub', name: 'DXF I/O', nameKey: 'pluginManager.builtinIoDxfName', version: '1.0.0', description: 'Import/export AutoCAD DXF format (Phase 3)', descriptionKey: 'pluginManager.builtinIoDxfDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-nio-stub', name: 'NIO Proto I/O', nameKey: 'pluginManager.builtinIoNioName', version: '1.0.0', description: 'Import/export NIO Protobuf maps (Phase 3)', descriptionKey: 'pluginManager.builtinIoNioDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-geoz-import', name: 'GeoZ Map Importer', version: '0.1.0', description: 'Import GeoZ format map files (ZIP + protobuf)', author: 'WorldEditor', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-mif-stub', name: 'MIF/MID I/O', nameKey: 'pluginManager.builtinIoMifName', version: '1.0.0', description: 'Import/export MapInfo MIF/MID (Phase 3)', descriptionKey: 'pluginManager.builtinIoMifDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-osm-export', name: 'OSM Export', nameKey: 'pluginManager.builtinIoOsmName', version: '1.0.0', description: 'Export roads as OpenStreetMap XML', descriptionKey: 'pluginManager.builtinIoOsmDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-signals', name: 'Signal JSON I/O', nameKey: 'pluginManager.builtinIoSignalsName', version: '1.0.0', description: 'Import signal JSON / export HD Map XML', descriptionKey: 'pluginManager.builtinIoSignalsDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-xodr-ext-stub', name: 'OpenDRIVE Extensions', nameKey: 'pluginManager.builtinIoXodrExtName', version: '1.0.0', description: 'OpenDRIVE custom extensions I/O (Phase 3)', descriptionKey: 'pluginManager.builtinIoXodrExtDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
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
];

/** Builtin plugins with mount functions attached. */
export const BUILTIN_PLUGINS: BuiltinPluginEntry[] = BUILTIN_META.map((meta) => ({
  ...meta,
  mount: MOUNT_MAP[meta.id] ?? (() => () => {}),
}));
