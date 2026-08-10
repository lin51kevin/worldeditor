/**
 * Built-in Templates Plugin
 *
 * Registers template sections into the TemplatePanel:
 *  - Roads (道路): predefined road cross-section types
 *  - Junctions (交汇处): intersection / fork patterns
 *  - Signals (信号): traffic lights only
 *  - Paints (喷漆): road surface paint arrows
 *  - Objects (附属物): road accessories
 *  - Signs (信号灯杆): poles and gantries
 *  - Road Signs (标志牌): GB 5768 warning/prohibitory/mandatory/supplementary
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
import {
  loadCatalog,
  buildRoadFromConfig,
  buildJunctionFromConfig,
  buildSignalFromConfig,
  buildRoadObjectFromConfig,
  buildSignFromConfig,
  genId,
} from './index';
import type {
  RoadTemplateConfig,
  JunctionTemplateConfig,
  SignalTemplateConfig,
  RoadObjectTemplateConfig,
  SignTemplateConfig,
  RoadSignTemplateConfig,
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

// ── Element naming convention ────────────────────────────────────────────────
//
// Names follow the pattern: <PascalCaseKey>_<NNN> where:
//   - PascalCaseKey is derived from the template id (kebab-case → PascalCase)
//       e.g. 'tpl:sig:traffic-light'  → 'TrafficLight'
//            'tpl:obj:crosswalk'      → 'Crosswalk'
//            'tpl:sign:gantry'        → 'Gantry'
//   - For GB 5768 road signs, a short category prefix replaces the full numeric code
//       e.g. 'tpl:rsign:1010100111001111' → 'WarnSign'   (警告标志 10101…)
//            'tpl:rsign:1010200100001914' → 'ProhibSign'  (禁令标志 10102…)
//            'tpl:rsign:1010300100002413' → 'MandSign'    (指示标志 10103…)
//            'tpl:rsign:1010400214132516' → 'SupplSign'   (辅助标志 10104…)
//            'tpl:rsign:1010203800001413_30' → 'SpeedLimit30'
//   - NNN is 1-based serial of existing elements in the same list, zero-padded to 3 digits

function deriveElementName(templateId: string, existingCount: number): string {
  const serial = String(existingCount + 1).padStart(3, '0');
  // Strip any template namespace prefix
  const key = templateId.replace(/^tpl:(?:sig|rsign|sign|obj):/, '');
  if (/^\d/.test(key)) {
    // Speed-limit variant: <code>_<speed> (e.g. 1010203800001413_30)
    const speedMatch = key.match(/^\d+_(\d+)$/);
    if (speedMatch) return `SpeedLimit${speedMatch[1]}_${serial}`;
    // GB 5768 category from first 5 digits
    if (key.startsWith('10101')) return `WarnSign_${serial}`;
    if (key.startsWith('10102')) return `ProhibSign_${serial}`;
    if (key.startsWith('10103')) return `MandSign_${serial}`;
    if (key.startsWith('10104')) return `SupplSign_${serial}`;
    return `Sign_${serial}`;
  }
  // Named key: kebab-case → PascalCase (e.g. 'arrow-straight' → 'ArrowStraight')
  const pascal = key.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return `${pascal}_${serial}`;
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
      const road = store.project.roads.find((r) => r.id === targetRoadId);
      const signal = {
        ...buildSignalFromConfig(config, road?.signals?.map((s) => String(s.id)) ?? undefined),
        name: deriveElementName(config.id, road?.signals?.length ?? 0),
        s: opts?.x ?? 0,
        t: opts?.y ?? 0,
      };
      store.addRoadSignalItem(targetRoadId, signal);
      store.selectSignal(targetRoadId, signal.id);
    },
  };
}

// ── Road sign config → TemplateItemDef ───────────────────────────────────────

function roadSignConfigToItem(config: RoadSignTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    thumbnailUrl: config.thumbnailUrl,
    onApply: (opts) => {
      const store = useProjectStore.getState();
      const targetRoadId = opts?.roadId ?? store.selectedRoadId;
      if (!targetRoadId) return;
      const road = store.project.roads.find((r) => r.id === targetRoadId);
      const signal = {
        id: genId(road?.signals?.map((s) => String(s.id)) ?? undefined),
        name: deriveElementName(config.id, road?.signals?.length ?? 0),
        s: opts?.x ?? 0,
        t: opts?.y ?? 0,
        z_offset: 3.5,
        signal_type: config.signalType ?? config.signCode,
        signal_subtype: '-1',
        value: config.signCode.match(/_(\d+)$/)?.[1] ?? null,
        width: config.defaultWidth ?? 0.8,
        height: config.defaultHeight ?? 0.8,
        h_offset: 0,
        orientation: '+' as const,
        is_dynamic: false,
        country: 'CN',
        unit: '',
        validities: [] as Array<{ from_lane: number; to_lane: number }>,
      };
      store.addRoadSignalItem(targetRoadId, signal);
      store.selectSignal(targetRoadId, signal.id);
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

  const paintSection: TemplateSectionContrib = {
    id: `${PLUGIN_ID}:paints`,
    pluginId: PLUGIN_ID,
    categoryKey: 'templatePanel.categories.paints',
    order: 3,
    items: (catalog.paints ?? []).map(signalConfigToItem),
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

  // Road signs split into sub-sections by GB 5768 category
  const roadSignsByCategory = new Map<string, RoadSignTemplateConfig[]>();
  for (const rs of catalog.roadSigns ?? []) {
    const cat = rs.subcategory;
    if (!roadSignsByCategory.has(cat)) roadSignsByCategory.set(cat, []);
    roadSignsByCategory.get(cat)!.push(rs);
  }

  const subcategoryOrder: Record<string, number> = {
    warning: 6,
    prohibitory: 7,
    mandatory: 8,
    supplementary: 9,
  };

  const roadSignSections: TemplateSectionContrib[] = [...roadSignsByCategory.entries()].map(
    ([cat, items]) => ({
      id: `${PLUGIN_ID}:roadSigns:${cat}`,
      pluginId: PLUGIN_ID,
      categoryKey: `templatePanel.categories.roadSigns.${cat}`,
      order: subcategoryOrder[cat] ?? 10,
      items: items.map(roadSignConfigToItem),
    }),
  );

  return [roadSection, junctionSection, signalSection, paintSection, objectSection, signSection, ...roadSignSections];
}

// ── Road-object config → TemplateItemDef ─────────────────────────────────────

function objectConfigToItem(config: RoadObjectTemplateConfig): TemplateItemDef {
  return {
    id: config.id,
    labelKey: config.labelKey,
    icon: config.icon,
    thumbnailUrl: config.thumbnailUrl,
    drawMode: config.drawMode,
    onApply: (opts) => {
      if (opts?.roadId === undefined) return;
      const store = useProjectStore.getState();
      const road = store.project.roads.find((r) => r.id === opts.roadId);
      const s = opts.x ?? 0;
      const t = opts.y ?? 0;
      const obj = buildRoadObjectFromConfig(config, s, t, opts.hdg ?? 0);
      obj.name = deriveElementName(config.id, road?.objects?.length ?? 0);
      // If polygon corners were provided, attach them as Road-frame corners
      if (opts.corners && opts.corners.length >= 3) {
        obj.corners = opts.corners.map((c) => ({ x: c.x, y: c.y, z: c.z, id: null }));
        obj.corner_type = 'Road';
      }
      store.addRoadObjectItem(opts.roadId, obj);
      store.selectObject(opts.roadId, obj.id);
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
      const store = useProjectStore.getState();
      const road = store.project.roads.find((r) => r.id === opts.roadId);
      const s = opts.x ?? 0;
      const t = opts.y ?? 0;
      const obj = buildSignFromConfig(config, s, t, opts.hdg ?? 0);
      obj.name = deriveElementName(config.id, road?.objects?.length ?? 0);
      store.addRoadObjectItem(opts.roadId, obj);
      store.selectObject(opts.roadId, obj.id);
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
