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
    selectSignal: vi.fn(),
    selectObject: vi.fn(),
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

vi.mock('./index', () => {
  // incremental genId mock to simulate unique numeric IDs in tests
  let _mockGenSeq = 0;
  return {
    loadCatalog: mocks.loadCatalog,
    buildRoadFromConfig: mocks.buildRoadFromConfig,
    buildJunctionFromConfig: mocks.buildJunctionFromConfig,
    buildSignalFromConfig: mocks.buildSignalFromConfig,
    buildMarkFromConfig: mocks.buildMarkFromConfig,
    buildRoadObjectFromConfig: mocks.buildRoadObjectFromConfig,
    buildSignFromConfig: mocks.buildSignFromConfig,
    genId: vi.fn(() => String(++_mockGenSeq)),
  };
});

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
    projectState.selectSignal = vi.fn();
    projectState.selectObject = vi.fn();
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
    expect(buildSignalFromConfig).toHaveBeenCalledWith(mockCatalog.signals[0], undefined);
    expect(projectState.addRoadSignalItem).toHaveBeenCalledWith(
      'road-1',
      expect.objectContaining({ id: 'signal-built', s: 3, t: 4 }),
    );

    // Paint items create signals via the same mechanism as signal templates
    paintSection.items[0].onApply({ x: 5, y: 6 });
    expect(buildSignalFromConfig).toHaveBeenCalledWith(mockCatalog.paints[0], undefined);
    expect(projectState.addRoadSignalItem).toHaveBeenCalledTimes(2);

    objectSection.items[0].onApply({ roadId: 'road-1', x: 7, y: 8, hdg: 0.25 });
    expect(buildRoadObjectFromConfig).toHaveBeenCalledWith(mockCatalog.objects[0], 7, 8, 0.25);
    expect(projectState.addRoadObjectItem).toHaveBeenCalledWith(
      'road-1',
      expect.objectContaining({ id: 'object-built', name: 'Test_001' }),
    );

    signSection.items[0].onApply({ roadId: 'road-1', x: 9, y: 10, hdg: 0.75 });
    expect(buildSignFromConfig).toHaveBeenCalledWith(mockCatalog.signs[0], 9, 10, 0.75);
    expect(projectState.addRoadObjectItem).toHaveBeenCalledWith(
      'road-1',
      expect.objectContaining({ id: 'sign-built', name: 'Test_001' }),
    );
  });

  describe('element naming', () => {
    it('derives PascalCase names from signal template ids', () => {
      const catalog = {
        ...mockCatalog,
        signals: [
          { id: 'tpl:sig:traffic-light', labelKey: 'l', icon: '', signalType: '1000001' },
          { id: 'tpl:sig:arrow-straight', labelKey: 'l', icon: '', signalType: 'Graphics', signalSubtype: 'straight' },
        ],
      };
      loadCatalog.mockReturnValue(catalog);
      buildSignalFromConfig.mockReturnValue({ id: 'sig', name: '', s: 0, t: 0 });

      mountTemplatesPlugin();
      const [, , signalSection] = getRegisteredSections();

      signalSection.items[0].onApply({ x: 0, y: 0 });
      expect(projectState.addRoadSignalItem).toHaveBeenCalledWith(
        'road-1',
        expect.objectContaining({ name: 'TrafficLight_001' }),
      );

      projectState.addRoadSignalItem.mockClear();
      signalSection.items[1].onApply({ x: 0, y: 0 });
      expect(projectState.addRoadSignalItem).toHaveBeenCalledWith(
        'road-1',
        expect.objectContaining({ name: 'ArrowStraight_001' }),
      );
    });

    it('derives short category names for GB 5768 road signs', () => {
      const catalog = {
        ...mockCatalog,
        roadSigns: [
          { id: 'tpl:rsign:1010100111001111', labelKey: 'l', icon: '', signCode: '1010100111001111', signalType: '1010100111001111', subcategory: 'warning', defaultWidth: 0.8, defaultHeight: 0.8 },
          { id: 'tpl:rsign:1010200100001914', labelKey: 'l', icon: '', signCode: '1010200100001914', signalType: '1010200100001914', subcategory: 'prohibitory', defaultWidth: 0.8, defaultHeight: 0.8 },
          { id: 'tpl:rsign:1010300100002413', labelKey: 'l', icon: '', signCode: '1010300100002413', signalType: '1010300100002413', subcategory: 'mandatory', defaultWidth: 0.8, defaultHeight: 0.8 },
          { id: 'tpl:rsign:1010400214132516', labelKey: 'l', icon: '', signCode: '1010400214132516', signalType: '1010400214132516', subcategory: 'supplementary', defaultWidth: 0.8, defaultHeight: 0.8 },
          { id: 'tpl:rsign:1010203800001413_30', labelKey: 'l', icon: '', signCode: '1010203800001413_30', signalType: '1010203800001413', subcategory: 'prohibitory', defaultWidth: 0.8, defaultHeight: 0.8 },
        ],
      };
      loadCatalog.mockReturnValue(catalog);

      mountTemplatesPlugin();
      // Road sign sections start after index 5 (roads/junctions/signals/paints/objects/signs)
      const sections = getRegisteredSections();
      const warnSection = sections.find((s) => s.id === 'builtin-templates:roadSigns:warning')!;
      const prohibSection = sections.find((s) => s.id === 'builtin-templates:roadSigns:prohibitory')!;
      const mandSection = sections.find((s) => s.id === 'builtin-templates:roadSigns:mandatory')!;
      const supplSection = sections.find((s) => s.id === 'builtin-templates:roadSigns:supplementary')!;

      const cases = [
        [warnSection.items[0], 'WarnSign_001'],
        [prohibSection.items[0], 'ProhibSign_001'],
        [mandSection.items[0], 'MandSign_001'],
        [supplSection.items[0], 'SupplSign_001'],
        [prohibSection.items[1], 'SpeedLimit30_001'],
      ] as const;

      for (const [item, expectedName] of cases) {
        projectState.addRoadSignalItem.mockClear();
        item.onApply({ roadId: 'road-1', x: 0, y: 0 });
        expect(projectState.addRoadSignalItem).toHaveBeenCalledWith(
          'road-1',
          expect.objectContaining({ name: expectedName }),
        );
      }
    });

    it('derives PascalCase names for road objects and sign poles', () => {
      const catalog = {
        ...mockCatalog,
        objects: [{ id: 'tpl:obj:crosswalk', labelKey: 'l', icon: '', objectType: 'Crosswalk' }],
        signs: [{ id: 'tpl:sign:gantry', labelKey: 'l', icon: '', objectType: 'SignGantry', defaultWidth: 8.0, defaultHeight: 6.0 }],
      };
      loadCatalog.mockReturnValue(catalog);
      buildRoadObjectFromConfig.mockReturnValue({ id: 'obj-1', name: '' });
      buildSignFromConfig.mockReturnValue({ id: 'sign-1', name: '' });

      mountTemplatesPlugin();
      const [, , , , objectSection, signSection] = getRegisteredSections();

      objectSection.items[0].onApply({ roadId: 'road-1', x: 0, y: 0, hdg: 0 });
      expect(projectState.addRoadObjectItem).toHaveBeenCalledWith(
        'road-1',
        expect.objectContaining({ name: 'Crosswalk_001' }),
      );

      projectState.addRoadObjectItem.mockClear();
      signSection.items[0].onApply({ roadId: 'road-1', x: 0, y: 0, hdg: 0 });
      expect(projectState.addRoadObjectItem).toHaveBeenCalledWith(
        'road-1',
        expect.objectContaining({ name: 'Gantry_001' }),
      );
    });

    it('increments serial based on existing element count', () => {
      loadCatalog.mockReturnValue(mockCatalog);
      buildSignalFromConfig.mockReturnValue({ id: 'sig', name: '', s: 0, t: 0 });
      // Project road already has 2 signals
      projectState.project = {
        ...makeProjectForMarking(),
        roads: [{ id: 'road-1', signals: [{ id: 's1' }, { id: 's2' }] }],
      };

      mountTemplatesPlugin();
      const [, , signalSection] = getRegisteredSections();

      signalSection.items[0].onApply({ x: 0, y: 0 });
      expect(projectState.addRoadSignalItem).toHaveBeenCalledWith(
        'road-1',
        expect.objectContaining({ name: 'Test_003' }),
      );
    });
  });
});
