import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerTemplateSection: vi.fn(),
  unregisterPlugin: vi.fn(),
  loadCatalog: vi.fn(),
  buildRoadFromConfig: vi.fn(),
  buildJunctionFromConfig: vi.fn(),
  buildSignalFromConfig: vi.fn(),
  buildMarkFromConfig: vi.fn(),
  buildRoadObjectFromConfig: vi.fn(),
  buildSignFromConfig: vi.fn(),
  projectState: {
    addRoad: vi.fn(),
    selectRoad: vi.fn(),
    executePluginCommand: vi.fn(),
    selectJunction: vi.fn(),
    addRoadSignalItem: vi.fn(),
    addRoadObjectItem: vi.fn(),
    setProject: vi.fn(),
    markDirty: vi.fn(),
    selectedRoadId: 'road-1' as string | null,
    project: {} as Record<string, unknown>,
  },
}));

const {
  registerTemplateSection,
  unregisterPlugin,
  loadCatalog,
  buildRoadFromConfig,
  buildJunctionFromConfig,
  buildSignalFromConfig,
  buildMarkFromConfig,
  buildRoadObjectFromConfig,
  buildSignFromConfig,
  projectState,
} = mocks;

vi.mock('../../../stores/pluginContribStore', () => ({
  usePluginContribStore: {
    getState: vi.fn(() => ({
      registerTemplateSection: mocks.registerTemplateSection,
      unregisterPlugin: mocks.unregisterPlugin,
    })),
  },
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => mocks.projectState),
  },
}));

vi.mock('./index', () => ({
  loadCatalog: mocks.loadCatalog,
  buildRoadFromConfig: mocks.buildRoadFromConfig,
  buildJunctionFromConfig: mocks.buildJunctionFromConfig,
  buildSignalFromConfig: mocks.buildSignalFromConfig,
  buildMarkFromConfig: mocks.buildMarkFromConfig,
  buildRoadObjectFromConfig: mocks.buildRoadObjectFromConfig,
  buildSignFromConfig: mocks.buildSignFromConfig,
}));

import { mountTemplatesPlugin } from './templates.plugin';

const mockCatalog = {
  version: '1.0.0',
  roads: [{ id: 'tpl:road:test', labelKey: 'roads.test', icon: 'R', left: [], right: [] }],
  junctions: [{ id: 'tpl:jct:test', labelKey: 'junctions.test', icon: 'J', topology: 'T', armLength: 100 }],
  signals: [{ id: 'tpl:sig:test', labelKey: 'signals.test', icon: 'S', signalType: '1000001' }],
  markings: [],
  paints: [{ id: 'tpl:sig:paint-test', labelKey: 'paints.test', icon: 'P', signalType: 'Graphics', signalSubtype: 'straight' }],
  objects: [{ id: 'tpl:obj:test', labelKey: 'objects.test', icon: 'O', objectType: 'Crosswalk' }],
  signs: [{ id: 'tpl:sign:test', labelKey: 'signs.test', icon: 'P', objectType: 'Sign' }],
};

const builtRoad = { id: 'road-built' };
const builtJunction = { id: 'junction-built' };
const builtExtraJunction = { id: 'junction-extra' };
const builtJunctionRoad = { id: 'junction-road' };
const builtSignal = { id: 'signal-built', name: 'Signal' };
const builtMark = { type: 'Solid', color: 'Standard' };
const builtObject = { id: 'object-built' };
const builtSign = { id: 'sign-built' };

function makeProjectForMarking() {
  return {
    name: 'Templates',
    header: {
      rev_major: 1,
      rev_minor: 6,
      name: '',
      date: '',
      north: 0,
      south: 0,
      east: 0,
      west: 0,
      geo_reference: null,
    },
    roads: [
      {
        id: 'road-1',
        lane_sections: [
          {
            left: [
              { lane_type: 'Driving', road_marks: [] },
              { lane_type: 'Shoulder', road_marks: [{ type: 'Existing' }] },
            ],
            right: [{ lane_type: 'Driving', road_marks: [] }],
          },
        ],
      },
    ],
    junctions: [],
    signals: [],
    objects: [],
  };
}

function getRegisteredSections() {
  return registerTemplateSection.mock.calls.map(([section]) => section);
}

describe('templates.plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCatalog.mockReturnValue(mockCatalog);
    buildRoadFromConfig.mockReturnValue(builtRoad);
    buildJunctionFromConfig.mockReturnValue({
      junction: builtJunction,
      roads: [builtJunctionRoad],
      extraJunctions: [builtExtraJunction],
    });
    buildSignalFromConfig.mockReturnValue(builtSignal);
    buildMarkFromConfig.mockReturnValue(builtMark);
    buildRoadObjectFromConfig.mockReturnValue(builtObject);
    buildSignFromConfig.mockReturnValue(builtSign);
    projectState.addRoad = vi.fn();
    projectState.selectRoad = vi.fn();
    projectState.executePluginCommand = vi.fn();
    projectState.selectJunction = vi.fn();
    projectState.addRoadSignalItem = vi.fn();
    projectState.addRoadObjectItem = vi.fn();
    projectState.setProject = vi.fn();
    projectState.markDirty = vi.fn();
    projectState.selectedRoadId = 'road-1';
    projectState.project = makeProjectForMarking();
  });

  it('loads the catalog, registers all template sections and unregisters on cleanup', () => {
    const cleanup = mountTemplatesPlugin();
    const sections = getRegisteredSections();

    expect(loadCatalog).toHaveBeenCalledOnce();
    expect(registerTemplateSection).toHaveBeenCalledTimes(6);
    expect(sections.map((section) => [section.id, section.categoryKey, section.order])).toEqual([
      ['builtin-templates:roads', 'templatePanel.categories.roads', 0],
      ['builtin-templates:junctions', 'templatePanel.categories.junctions', 1],
      ['builtin-templates:signals', 'templatePanel.categories.signals', 2],
      ['builtin-templates:paints', 'templatePanel.categories.paints', 3],
      ['builtin-templates:objects', 'templatePanel.categories.objects', 4],
      ['builtin-templates:signs', 'templatePanel.categories.signs', 5],
    ]);
    expect(sections.every((section) => section.pluginId === 'builtin-templates')).toBe(true);

    cleanup();
    expect(unregisterPlugin).toHaveBeenCalledWith('builtin-templates');
  });

  it('wires template items to the build helpers and project actions', () => {
    mountTemplatesPlugin();
    const [roadSection, junctionSection, signalSection, paintSection, objectSection, signSection] =
      getRegisteredSections();

    roadSection.items[0].onApply({ x: 10, y: 20, hdg: 0.5 });
    expect(buildRoadFromConfig).toHaveBeenCalledWith(mockCatalog.roads[0], 10, 20, 0.5);
    expect(projectState.addRoad).toHaveBeenCalledWith(builtRoad);
    expect(projectState.selectRoad).toHaveBeenCalledWith('road-built');

    let updatedProject: Record<string, unknown> | undefined;
    projectState.executePluginCommand = vi.fn((_label, update) => {
      updatedProject = update({ ...makeProjectForMarking(), roads: [], junctions: [] });
    });
    junctionSection.items[0].onApply({ x: 5, y: 6 });
    expect(buildJunctionFromConfig).toHaveBeenCalledWith(mockCatalog.junctions[0], 5, 6);
    expect(projectState.executePluginCommand).toHaveBeenCalledWith(
      'Add junction template',
      expect.any(Function),
    );
    expect(updatedProject).toMatchObject({
      roads: [builtJunctionRoad],
      junctions: [builtJunction, builtExtraJunction],
    });
    expect(projectState.selectJunction).toHaveBeenCalledWith('junction-built');

    signalSection.items[0].onApply({ x: 3, y: 4 });
    expect(buildSignalFromConfig).toHaveBeenCalledWith(mockCatalog.signals[0]);
    expect(projectState.addRoadSignalItem).toHaveBeenCalledWith(
      'road-1',
      expect.objectContaining({ id: 'signal-built', s: 3, t: 4 }),
    );

    // Paint items create signals via the same mechanism as signal templates
    paintSection.items[0].onApply({ x: 5, y: 6 });
    expect(buildSignalFromConfig).toHaveBeenCalledWith(mockCatalog.paints[0]);
    expect(projectState.addRoadSignalItem).toHaveBeenCalledTimes(2);

    objectSection.items[0].onApply({ roadId: 'road-1', x: 7, y: 8, hdg: 0.25 });
    expect(buildRoadObjectFromConfig).toHaveBeenCalledWith(mockCatalog.objects[0], 7, 8, 0.25);
    expect(projectState.addRoadObjectItem).toHaveBeenCalledWith('road-1', builtObject);

    signSection.items[0].onApply({ roadId: 'road-1', x: 9, y: 10, hdg: 0.75 });
    expect(buildSignFromConfig).toHaveBeenCalledWith(mockCatalog.signs[0], 9, 10, 0.75);
    expect(projectState.addRoadObjectItem).toHaveBeenCalledWith('road-1', builtSign);
  });
});
