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
  { id: 'io-csv', name: 'CSV I/O', nameKey: 'pluginManager.builtinIoCsvName', version: '1.0.0', description: 'Import/export roads as CSV', descriptionKey: 'pluginManager.builtinIoCsvDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-obj3d', name: 'OBJ 3D Export', nameKey: 'pluginManager.builtinIoObj3dName', version: '1.0.0', description: 'Export 3D road mesh as OBJ', descriptionKey: 'pluginManager.builtinIoObj3dDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-lanelet2', name: 'Lanelet2 I/O', nameKey: 'pluginManager.builtinIoLanelet2Name', version: '1.0.0', description: 'Import/export Lanelet2 HD maps', descriptionKey: 'pluginManager.builtinIoLanelet2Desc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-shapefile', name: 'Shapefile I/O', nameKey: 'pluginManager.builtinIoShapefileName', version: '1.0.0', description: 'Import/export Shapefile format (Phase 3)', descriptionKey: 'pluginManager.builtinIoShapefileDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-dxf', name: 'DXF I/O', nameKey: 'pluginManager.builtinIoDxfName', version: '1.0.0', description: 'Import/export AutoCAD DXF format (Phase 3)', descriptionKey: 'pluginManager.builtinIoDxfDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-nio', name: 'NIO Proto I/O', nameKey: 'pluginManager.builtinIoNioName', version: '1.0.0', description: 'Import/export NIO Protobuf maps (Phase 3)', descriptionKey: 'pluginManager.builtinIoNioDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-mif', name: 'MIF/MID I/O', nameKey: 'pluginManager.builtinIoMifName', version: '1.0.0', description: 'Import/export MapInfo MIF/MID (Phase 3)', descriptionKey: 'pluginManager.builtinIoMifDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-osm', name: 'OSM Export', nameKey: 'pluginManager.builtinIoOsmName', version: '1.0.0', description: 'Export roads as OpenStreetMap XML', descriptionKey: 'pluginManager.builtinIoOsmDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-signals', name: 'Signal JSON I/O', nameKey: 'pluginManager.builtinIoSignalsName', version: '1.0.0', description: 'Import signal JSON / export HD Map XML', descriptionKey: 'pluginManager.builtinIoSignalsDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'io-xodr-ext', name: 'OpenDRIVE Extensions', nameKey: 'pluginManager.builtinIoXodrExtName', version: '1.0.0', description: 'OpenDRIVE custom extensions I/O (Phase 3)', descriptionKey: 'pluginManager.builtinIoXodrExtDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'gis-tools', name: 'GIS Tools', nameKey: 'pluginManager.builtinGisToolsName', version: '1.0.0', description: 'Advanced GIS coordinate systems panel', descriptionKey: 'pluginManager.builtinGisToolsDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'validation', name: 'Validation', nameKey: 'pluginManager.builtinValidationName', version: '1.0.0', description: 'OpenDRIVE data quality and topology validation', descriptionKey: 'pluginManager.builtinValidationDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'traffic', name: 'Traffic', nameKey: 'pluginManager.builtinTrafficName', version: '1.0.0', description: 'Signal phasing, timing editor, SUMO I/O', descriptionKey: 'pluginManager.builtinTrafficDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'pointcloud', name: 'Point Cloud', nameKey: 'pluginManager.builtinPointcloudName', version: '1.0.0', description: 'Point cloud loading and visualization (desktop only)', descriptionKey: 'pluginManager.builtinPointcloudDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'satellite', name: 'Satellite', nameKey: 'pluginManager.builtinSatelliteName', version: '1.0.0', description: 'OSM tiles and satellite imagery overlay (desktop only)', descriptionKey: 'pluginManager.builtinSatelliteDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: '3d-models', name: '3D Models', nameKey: 'pluginManager.builtin3dModelsName', version: '1.0.0', description: 'External 3D model loading OBJ/FBX (desktop only)', descriptionKey: 'pluginManager.builtin3dModelsDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'scripting', name: 'Scripting', nameKey: 'pluginManager.builtinScriptingName', version: '1.0.0', description: 'Embedded Rhai script console', descriptionKey: 'pluginManager.builtinScriptingDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'ecosystem', name: 'Ecosystem', nameKey: 'pluginManager.builtinEcosystemName', version: '1.0.0', description: 'Vegetation and tree placement panel', descriptionKey: 'pluginManager.builtinEcosystemDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'lane-detect', name: 'Lane Detection', nameKey: 'pluginManager.builtinLaneDetectName', version: '1.0.0', description: 'Automated lane detection (Phase 3)', descriptionKey: 'pluginManager.builtinLaneDetectDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
  { id: 'converter', name: 'Batch Converter', nameKey: 'pluginManager.builtinConverterName', version: '1.0.0', description: 'Batch format conversion panel', descriptionKey: 'pluginManager.builtinConverterDesc', dependencies: [], permissions: [], status: 'loaded', isBuiltin: true },
];
