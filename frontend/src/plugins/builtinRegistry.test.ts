import { beforeEach, describe, expect, it, vi } from 'vitest';

const mounts = vi.hoisted(() => {
  const createMountPair = () => {
    const cleanup = vi.fn();
    return {
      cleanup,
      mount: vi.fn(() => cleanup),
    };
  };

  return {
    roadTools: createMountPair(),
    templates: createMountPair(),
    advancedEditing: createMountPair(),
    converter: createMountPair(),
    aiCopilot: createMountPair(),
    ioCsv: createMountPair(),
    ioObj3d: createMountPair(),
    ioGeoZ: createMountPair(),
    ioOsm: createMountPair(),
    ioSignals: createMountPair(),
    ioLanelet2: createMountPair(),
    ioShapefile: createMountPair(),
    ioDxf: createMountPair(),
    ioNio: createMountPair(),
    ioMif: createMountPair(),
    ioXodrExt: createMountPair(),
    validation: createMountPair(),
    traffic: createMountPair(),
    laneDetect: createMountPair(),
    gisTools: createMountPair(),
    pointcloud: createMountPair(),
    satellite: createMountPair(),
    models3d: createMountPair(),
    scripting: createMountPair(),
    ecosystem: createMountPair(),
    shapeEditor: createMountPair(),
  };
});

vi.mock('./editing/road-tools/road-tools.plugin', () => ({ mountRoadToolsPlugin: mounts.roadTools.mount }));
vi.mock('./editing/templates/templates.plugin', () => ({ mountTemplatesPlugin: mounts.templates.mount }));
vi.mock('./editing/advanced-editing/advanced-editing.plugin', () => ({ mountAdvancedEditingPlugin: mounts.advancedEditing.mount }));
vi.mock('./editing/converter/converter.plugin', () => ({ mountConverterPlugin: mounts.converter.mount }));
vi.mock('./editing/ai-copilot/ai-copilot.plugin', () => ({ mountAiCopilotPlugin: mounts.aiCopilot.mount }));
vi.mock('./io/csv/io-csv.plugin', () => ({ mountIoCsvPlugin: mounts.ioCsv.mount }));
vi.mock('./io/obj3d/io-obj3d.plugin', () => ({ mountIoObj3dPlugin: mounts.ioObj3d.mount }));
vi.mock('./io/geoz/io-geoz.plugin', () => ({ mountIoGeoZPlugin: mounts.ioGeoZ.mount }));
vi.mock('./io/osm/io-osm.plugin', () => ({ mountIoOsmPlugin: mounts.ioOsm.mount }));
vi.mock('./io/signals/io-signals.plugin', () => ({ mountIoSignalsPlugin: mounts.ioSignals.mount }));
vi.mock('./io/lanelet2/io-lanelet2.plugin', () => ({ mountIoLanelet2Plugin: mounts.ioLanelet2.mount }));
vi.mock('./io/shapefile/io-shapefile.plugin', () => ({ mountIoShapefilePlugin: mounts.ioShapefile.mount }));
vi.mock('./io/dxf/io-dxf.plugin', () => ({ mountIoDxfPlugin: mounts.ioDxf.mount }));
vi.mock('./io/nio/io-nio.plugin', () => ({ mountIoNioPlugin: mounts.ioNio.mount }));
vi.mock('./io/mif/io-mif.plugin', () => ({ mountIoMifPlugin: mounts.ioMif.mount }));
vi.mock('./io/xodr-ext/io-xodr-ext.plugin', () => ({ mountIoXodrExtPlugin: mounts.ioXodrExt.mount }));
vi.mock('./analysis/validation/validation.plugin', () => ({ mountValidationPlugin: mounts.validation.mount }));
vi.mock('./analysis/traffic/traffic.plugin', () => ({ mountTrafficPlugin: mounts.traffic.mount }));
vi.mock('./analysis/lane-detect/lane-detect-beta.plugin', () => ({ mountLaneDetectPlugin: mounts.laneDetect.mount }));
vi.mock('./gis-viz/gis-tools/gis-tools.plugin', () => ({ mountGisToolsPlugin: mounts.gisTools.mount }));
vi.mock('./gis-viz/pointcloud/pointcloud-beta.plugin', () => ({ mountPointcloudPlugin: mounts.pointcloud.mount }));
vi.mock('./gis-viz/satellite/satellite-beta.plugin', () => ({ mountSatellitePlugin: mounts.satellite.mount }));
vi.mock('./gis-viz/models-3d/models-3d-beta.plugin', () => ({ mountModels3dPlugin: mounts.models3d.mount }));
vi.mock('./gis-viz/scripting/scripting-beta.plugin', () => ({ mountScriptingPlugin: mounts.scripting.mount }));
vi.mock('./gis-viz/ecosystem/ecosystem-beta.plugin', () => ({ mountEcosystemPlugin: mounts.ecosystem.mount }));
vi.mock('./editing/shape-editor/shape-editor.plugin', () => ({ mountShapeEditorPlugin: mounts.shapeEditor.mount }));

import { BUILTIN_PLUGINS } from './builtinRegistry';

const mountById = {
  'road-tools': mounts.roadTools,
  'builtin-templates': mounts.templates,
  'advanced-editing': mounts.advancedEditing,
  converter: mounts.converter,
  'ai-copilot': mounts.aiCopilot,
  'io-csv-import': mounts.ioCsv,
  'io-obj3d-export': mounts.ioObj3d,
  'io-geoz-import': mounts.ioGeoZ,
  'io-osm-export': mounts.ioOsm,
  'io-signals': mounts.ioSignals,
  'io-lanelet2': mounts.ioLanelet2,
  'io-shapefile': mounts.ioShapefile,
  'io-dxf': mounts.ioDxf,
  'io-nio': mounts.ioNio,
  'io-mif': mounts.ioMif,
  'io-xodr-ext': mounts.ioXodrExt,
  validation: mounts.validation,
  traffic: mounts.traffic,
  'lane-detect': mounts.laneDetect,
  'gis-tools': mounts.gisTools,
  'pointcloud-beta': mounts.pointcloud,
  'satellite-beta': mounts.satellite,
  '3d-models': mounts.models3d,
  'scripting-beta': mounts.scripting,
  'ecosystem-beta': mounts.ecosystem,
  'shape-editor': mounts.shapeEditor,
} satisfies Record<string, { mount: ReturnType<typeof vi.fn>; cleanup: ReturnType<typeof vi.fn> }>;

describe('builtinRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes all built-in plugins with loaded builtin metadata', () => {
    expect(BUILTIN_PLUGINS).toHaveLength(26);
    expect(BUILTIN_PLUGINS.every((plugin) => plugin.isBuiltin)).toBe(true);
    expect(BUILTIN_PLUGINS.every((plugin) => plugin.status === 'loaded')).toBe(true);
    expect(BUILTIN_PLUGINS.every((plugin) => typeof plugin.mount === 'function')).toBe(true);
  });

  it('keeps all builtin plugin ids unique', () => {
    const ids = BUILTIN_PLUGINS.map((plugin) => plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('delegates each builtin entry to its corresponding mount function', () => {
    for (const plugin of BUILTIN_PLUGINS) {
      const cleanup = plugin.mount();
      expect(mountById[plugin.id]).toBeDefined();
      expect(mountById[plugin.id].mount).toHaveBeenCalledOnce();
      expect(typeof cleanup).toBe('function');
      cleanup();
      expect(mountById[plugin.id].cleanup).toHaveBeenCalledOnce();
    }
  });
});
