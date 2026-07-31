import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import type { Lane, Project, Road } from '../../services/platform';

/** Lane types offered for batch application (mirrors LaneEditor's common set). */
const BATCH_LANE_TYPES = [
  'Driving', 'Shoulder', 'Sidewalk', 'Parking', 'Biking', 'Border', 'Stop', 'None',
] as const;

interface BatchRoadEditorProps {
  /** IDs of the roads currently multi-selected. */
  roadIds: string[];
}

/**
 * Batch property editor shown when more than one road is selected.
 *
 * Every action is applied as a single undo step through `executePluginCommand`,
 * mutating only the selected roads immutably.
 */
export function BatchRoadEditor({ roadIds }: BatchRoadEditorProps) {
  const { t } = useTranslation();
  const idSet = useMemo(() => new Set(roadIds), [roadIds]);

  const [namePrefix, setNamePrefix] = useState('');
  const [speed, setSpeed] = useState('');
  const [laneType, setLaneType] = useState<string>('Driving');
  const [laneWidth, setLaneWidth] = useState('');

  const run = (description: string, fn: (project: Project) => Project) => {
    useProjectStore.getState().executePluginCommand(description, fn);
  };

  /** Map over selected roads only, leaving others untouched. */
  const mapSelected = (project: Project, roadFn: (road: Road, order: number) => Road): Project => {
    let order = 0;
    return {
      ...project,
      roads: project.roads.map((r) => {
        if (!idSet.has(r.id)) return r;
        const result = roadFn(r, order);
        order += 1;
        return result;
      }),
    };
  };

  const applyNamePrefix = () => {
    run('Batch rename roads', (project) =>
      mapSelected(project, (road, order) => ({ ...road, name: `${namePrefix}${order + 1}` })),
    );
  };

  const applySpeed = () => {
    const parsed = parseFloat(speed);
    if (Number.isNaN(parsed) || parsed < 0) return;
    run('Batch set road speed', (project) =>
      mapSelected(project, (road) => ({ ...road, speed: parsed })),
    );
  };

  const applyLaneType = () => {
    run('Batch set lane type', (project) =>
      mapSelected(project, (road) => ({
        ...road,
        lane_sections: road.lane_sections.map((section) => ({
          ...section,
          left: section.left.map((lane) => setLaneTypeOn(lane, laneType)),
          right: section.right.map((lane) => setLaneTypeOn(lane, laneType)),
        })),
      })),
    );
  };

  const applyLaneWidth = () => {
    const parsed = parseFloat(laneWidth);
    if (Number.isNaN(parsed) || parsed <= 0) return;
    run('Batch set lane width', (project) =>
      mapSelected(project, (road) => ({
        ...road,
        lane_sections: road.lane_sections.map((section) => ({
          ...section,
          left: section.left.map((lane) => setLaneWidthOn(lane, parsed)),
          right: section.right.map((lane) => setLaneWidthOn(lane, parsed)),
        })),
      })),
    );
  };

  const setVisibility = (hidden: boolean) => {
    run(hidden ? 'Batch hide roads' : 'Batch show roads', (project) =>
      mapSelected(project, (road) => ({ ...road, render_hidden: hidden })),
    );
  };

  const deleteAll = () => {
    run('Batch delete roads', (project) => ({
      ...project,
      roads: project.roads.filter((r) => !idSet.has(r.id)),
    }));
    useProjectStore.getState().selectMultiple([], []);
  };

  return (
    <div className="inspector-cards">
      <div className="inspector-card">
        <div className="inspector-card-header">
          <span>{t('batchEdit.title', { count: roadIds.length })}</span>
        </div>
        <div className="inspector-card-body">
          {/* Name prefix */}
          <div className="property-row">
            <span className="property-label">{t('batchEdit.namePrefix')}</span>
            <input
              className="property-input"
              value={namePrefix}
              placeholder="Road_"
              aria-label={t('batchEdit.namePrefix')}
              data-testid="batch-name-prefix"
              onChange={(e) => setNamePrefix(e.target.value)}
            />
            <button className="property-btn" data-testid="batch-name-apply" onClick={applyNamePrefix}>{t('batchEdit.apply')}</button>
          </div>

          {/* Speed */}
          <div className="property-row">
            <span className="property-label">{t('batchEdit.speed')}</span>
            <input
              className="property-input property-input-narrow"
              type="number"
              min="0"
              step="1"
              value={speed}
              aria-label={t('batchEdit.speed')}
              data-testid="batch-speed"
              onChange={(e) => setSpeed(e.target.value)}
            />
            <button className="property-btn" data-testid="batch-speed-apply" onClick={applySpeed}>{t('batchEdit.apply')}</button>
          </div>

          {/* Lane type */}
          <div className="property-row">
            <span className="property-label">{t('batchEdit.laneType')}</span>
            <select
              className="property-select"
              value={laneType}
              aria-label={t('batchEdit.laneType')}
              data-testid="batch-lane-type"
              onChange={(e) => setLaneType(e.target.value)}
            >
              {BATCH_LANE_TYPES.map((lt) => (
                <option key={lt} value={lt}>{lt}</option>
              ))}
            </select>
            <button className="property-btn" data-testid="batch-lane-type-apply" onClick={applyLaneType}>{t('batchEdit.apply')}</button>
          </div>

          {/* Lane width */}
          <div className="property-row">
            <span className="property-label">{t('batchEdit.laneWidth')}</span>
            <input
              className="property-input property-input-narrow"
              type="number"
              min="0"
              step="0.1"
              value={laneWidth}
              aria-label={t('batchEdit.laneWidth')}
              data-testid="batch-lane-width"
              onChange={(e) => setLaneWidth(e.target.value)}
            />
            <button className="property-btn" data-testid="batch-lane-width-apply" onClick={applyLaneWidth}>{t('batchEdit.apply')}</button>
          </div>

          {/* Visibility */}
          <div className="property-row">
            <span className="property-label">{t('batchEdit.visibility')}</span>
            <div className="property-lane-controls">
              <button className="property-btn" data-testid="batch-hide" onClick={() => setVisibility(true)}>{t('batchEdit.hideAll')}</button>
              <button className="property-btn" data-testid="batch-show" onClick={() => setVisibility(false)}>{t('batchEdit.showAll')}</button>
            </div>
          </div>

          {/* Delete */}
          <div className="property-row">
            <button className="property-btn property-btn-danger" data-testid="batch-delete" onClick={deleteAll}>
              {t('batchEdit.deleteAll', { count: roadIds.length })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Return a copy of `lane` with its type set, leaving the center lane (id 0) untouched. */
function setLaneTypeOn(lane: Lane, laneType: string): Lane {
  if (lane.id === 0) return lane;
  return { ...lane, lane_type: laneType };
}

/** Return a copy of `lane` with a single constant-width record, skipping the center lane. */
function setLaneWidthOn(lane: Lane, width: number): Lane {
  if (lane.id === 0) return lane;
  return { ...lane, width: [{ s_offset: 0, a: width, b: 0, c: 0, d: 0 }] };
}
