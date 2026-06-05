/**
 * Built-in Templates Plugin
 *
 * Registers four template sections into the TemplatePanel:
 *  - Roads (道路): predefined road cross-section types
 *  - Junctions (交汇处): intersection / fork patterns
 *  - Signals (信号): traffic signs and lights
 *  - Markings (喷漆): road surface paint/mark presets
 *
 * All template definitions are loaded from the declarative catalog
 * (templates/defaultCatalog.ts). The template engine (templates/engine.ts)
 * converts configs into domain objects. This plugin only wires them to
 * store actions and registers them as TemplateSectionContrib items.
 *
 * To add a new template: edit defaultCatalog.ts — no code changes needed here.
 *
 * Call mountTemplatesPlugin() once on app init; returns a cleanup function.
 */
import { useProjectStore } from '../../../stores/projectStore';
import { usePluginContribStore } from '../../../stores/pluginContribStore';
import type { TemplateSectionContrib, TemplateItemDef } from '../../../stores/pluginContribStore';
import type { Lane, LaneSection, RoadMark } from '../../../services/platform';
import {
  loadCatalog,
  buildRoadFromConfig,
  buildJunctionFromConfig,
  buildSignalFromConfig,
  buildMarkFromConfig,
  buildRoadObjectFromConfig,
  buildSignFromConfig,
} from './index';
import type {
  RoadTemplateConfig,
  JunctionTemplateConfig,
  SignalTemplateConfig,
  MarkingTemplateConfig,
  RoadObjectTemplateConfig,
  SignTemplateConfig,
} from './index';

const PLUGIN_ID = 'builtin-templates';

// ── Road config → TemplateItemDef ────────────────────────────────────────────

function roadConfigToItem(config: RoadTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    thumbnailUrl: config.thumbnailUrl,
    onApply: (opts) => {
      if (opts?.x === undefined || opts?.y === undefined) return;
      const road = buildRoadFromConfig(config, opts.x, opts.y, opts.hdg ?? 0);
      const store = useProjectStore.getState();
      store.addRoad(road);
      store.selectRoad(road.id);
    },
  };
}

// ── Junction config → TemplateItemDef ────────────────────────────────────────

function junctionConfigToItem(config: JunctionTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    thumbnailUrl: config.thumbnailUrl,
    onApply: (opts) => {
      if (opts?.x === undefined || opts?.y === undefined) return;
      const { junction, roads, extraJunctions } = buildJunctionFromConfig(config, opts.x, opts.y);
      const store = useProjectStore.getState();
      // Batch all junctions + roads into a single undo entry
      store.executePluginCommand('Add junction template', (project) => ({
        ...project,
        roads: [...project.roads, ...roads],
        junctions: [...project.junctions, junction, ...(extraJunctions ?? [])],
      }));
      store.selectJunction(junction.id);
    },
  };
}

// ── Signal config → TemplateItemDef ──────────────────────────────────────────

function signalConfigToItem(config: SignalTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    thumbnailUrl: config.thumbnailUrl,
    onApply: (opts) => {
      const store = useProjectStore.getState();
      const targetRoadId = opts?.roadId ?? store.selectedRoadId;
      if (!targetRoadId) return;
      const signal = {
        ...buildSignalFromConfig(config),
        s: opts?.x ?? 0,
        t: opts?.y ?? 0,
      };
      store.addRoadSignalItem(targetRoadId, signal);
    },
  };
}

// ── Marking config → TemplateItemDef ─────────────────────────────────────────

function markingConfigToItem(config: MarkingTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    onApply: (opts) => {
      const mark: RoadMark = buildMarkFromConfig(config);
      const { selectedRoadId, project } = useProjectStore.getState();
      const targetRoadId = opts?.roadId ?? selectedRoadId;
      if (!targetRoadId) return;
      const road = project.roads.find((r) => r.id === targetRoadId);
      if (!road || road.lane_sections.length === 0) return;

      const section = road.lane_sections[0]!;
      const applyMark = (lanes: Lane[]): Lane[] =>
        lanes.map((lane) =>
          lane.lane_type === 'Driving' ? { ...lane, road_marks: [mark] } : lane,
        );

      const updatedSection: LaneSection = {
        ...section,
        left: applyMark(section.left),
        right: applyMark(section.right),
      };
      const updatedRoad = {
        ...road,
        lane_sections: road.lane_sections.map((s, i) => (i === 0 ? updatedSection : s)),
      };

      const { project: proj } = useProjectStore.getState();
      useProjectStore.getState().setProject({
        ...proj,
        roads: proj.roads.map((r) => (r.id === targetRoadId ? updatedRoad : r)),
      });
      useProjectStore.getState().markDirty();
    },
  };
}

// ── Build sections from catalog ──────────────────────────────────────────────

function buildSections(): TemplateSectionContrib[] {
  const catalog = loadCatalog();

  const roadSection: TemplateSectionContrib = {
    id: `${PLUGIN_ID}:roads`,
    pluginId: PLUGIN_ID,
    categoryKey: 'templatePanel.categories.roads',
    order: 0,
    items: catalog.roads.map(roadConfigToItem),
  };

  const junctionSection: TemplateSectionContrib = {
    id: `${PLUGIN_ID}:junctions`,
    pluginId: PLUGIN_ID,
    categoryKey: 'templatePanel.categories.junctions',
    order: 1,
    items: catalog.junctions.map(junctionConfigToItem),
  };

  const signalSection: TemplateSectionContrib = {
    id: `${PLUGIN_ID}:signals`,
    pluginId: PLUGIN_ID,
    categoryKey: 'templatePanel.categories.signals',
    order: 2,
    items: catalog.signals.map(signalConfigToItem),
  };

  const markingSection: TemplateSectionContrib = {
    id: `${PLUGIN_ID}:markings`,
    pluginId: PLUGIN_ID,
    categoryKey: 'templatePanel.categories.markings',
    order: 3,
    items: catalog.markings.map(markingConfigToItem),
  };

  const objectSection: TemplateSectionContrib = {
    id: `${PLUGIN_ID}:objects`,
    pluginId: PLUGIN_ID,
    categoryKey: 'templatePanel.categories.objects',
    order: 4,
    items: catalog.objects.map(objectConfigToItem),
  };

  const signSection: TemplateSectionContrib = {
    id: `${PLUGIN_ID}:signs`,
    pluginId: PLUGIN_ID,
    categoryKey: 'templatePanel.categories.signs',
    order: 5,
    items: catalog.signs.map(signConfigToItem),
  };

  return [roadSection, junctionSection, signalSection, markingSection, objectSection, signSection];
}

// ── Road-object config → TemplateItemDef ─────────────────────────────────────

function objectConfigToItem(config: RoadObjectTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    thumbnailUrl: config.thumbnailUrl,
    onApply: (opts) => {
      if (opts?.roadId === undefined) return;
      const s = opts.x ?? 0;
      const t = opts.y ?? 0;
      const obj = buildRoadObjectFromConfig(config, s, t, opts.hdg ?? 0);
      const store = useProjectStore.getState();
      store.addRoadObjectItem(opts.roadId, obj);
    },
  };
}

// ── Sign config → TemplateItemDef ─────────────────────────────────────────────

function signConfigToItem(config: SignTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    thumbnailUrl: config.thumbnailUrl,
    onApply: (opts) => {
      if (opts?.roadId === undefined) return;
      const s = opts.x ?? 0;
      const t = opts.y ?? 0;
      const obj = buildSignFromConfig(config, s, t, opts.hdg ?? 0);
      const store = useProjectStore.getState();
      store.addRoadObjectItem(opts.roadId, obj);
    },
  };
}

// ── Plugin mount/unmount ─────────────────────────────────────────────────────

export function mountTemplatesPlugin(): () => void {
  const { registerTemplateSection, unregisterPlugin } = usePluginContribStore.getState();

  for (const section of buildSections()) {
    registerTemplateSection(section);
  }

  return () => unregisterPlugin(PLUGIN_ID);
}
