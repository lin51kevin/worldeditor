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
];
