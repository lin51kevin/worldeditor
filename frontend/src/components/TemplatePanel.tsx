import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import type { Road, Lane, LaneSection, Geometry } from '../services/platform';
import './TemplatePanel.css';

interface RoadTemplate {
  id: string;
  labelKey: string;
  icon: string;
}

const ROAD_TEMPLATES: RoadTemplate[] = [
  { id: 'single', labelKey: 'templatePanel.singleLane', icon: '╺' },
  { id: 'dual2', labelKey: 'templatePanel.dualTwoLane', icon: '┃┃' },
  { id: 'dual4', labelKey: 'templatePanel.dualFourLane', icon: '┃┃┃┃' },
  { id: 'dual6', labelKey: 'templatePanel.dualSixLane', icon: '┃┃┃┃┃┃' },
  { id: 'fork3', labelKey: 'templatePanel.fork3', icon: '⋔' },
  { id: 'fork4', labelKey: 'templatePanel.fork4', icon: '✜' },
  { id: 'fork5', labelKey: 'templatePanel.fork5', icon: '✳' },
  { id: 'fork6', labelKey: 'templatePanel.fork6', icon: '✴' },
  { id: 'fork7', labelKey: 'templatePanel.fork7', icon: '✵' },
];

const LANE_WIDTH = 3.5;

function makeLane(id: number, laneType = 'Driving'): Lane {
  return {
    id,
    lane_type: laneType,
    level: false,
    link: { predecessor: null, successor: null },
    width: [{ s_offset: 0, a: LANE_WIDTH, b: 0, c: 0, d: 0 }],
    road_marks: [],
  };
}

function makeLaneSection(leftCount: number, rightCount: number): LaneSection {
  const left: Lane[] = [];
  for (let i = 1; i <= leftCount; i++) left.push(makeLane(i));
  const right: Lane[] = [];
  for (let i = 1; i <= rightCount; i++) right.push(makeLane(-i));
  return {
    s: 0,
    single_side: false,
    left,
    center: [makeLane(0, 'None')],
    right,
  };
}

const TEMPLATE_LANES: Record<string, [number, number]> = {
  single: [0, 1],
  dual2: [1, 1],
  dual4: [2, 2],
  dual6: [3, 3],
};

function createRoadFromTemplate(templateId: string): Road | null {
  const laneCounts = TEMPLATE_LANES[templateId];
  if (!laneCounts) return null;
  const [leftCount, rightCount] = laneCounts;

  const roadLength = 100;
  const id = `road_${Date.now()}`;

  const geometry: Geometry = {
    s: 0,
    x: 0,
    y: 0,
    hdg: 0,
    length: roadLength,
    geo_type: 'Line',
  };

  return {
    id,
    name: '',
    length: roadLength,
    junction_id: null,
    link: { predecessor: null, successor: null },
    plan_view: [geometry],
    elevation_profile: [],
    lane_sections: [makeLaneSection(leftCount, rightCount)],
  };
}

export function TemplatePanel() {
  const { t } = useTranslation();

  const handleTemplateClick = (templateId: string) => {
    const road = createRoadFromTemplate(templateId);
    if (road) {
      useEditorStore.getState().addRoad(road);
      useEditorStore.getState().selectRoad(road.id);
    }
  };

  return (
    <div className="template-panel">
      <div className="template-header">{t('templatePanel.header')}</div>
      <div className="template-grid">
        {ROAD_TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="template-item"
            title={t(tpl.labelKey)}
            onClick={() => handleTemplateClick(tpl.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') handleTemplateClick(tpl.id); }}
          >            <div className="template-thumb">{tpl.icon}</div>
            <div className="template-label">{t(tpl.labelKey)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
