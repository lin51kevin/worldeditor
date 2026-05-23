import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { showConfirm } from '../../utils/dialog';
import type { RoadMark } from '../../services/platform';
import './RoadMarkingPanel.css';

const MARK_TYPES = ['Solid', 'Broken', 'SolidSolid', 'SolidBroken', 'BrokenSolid', 'BrokenBroken', 'BottsDots', 'Curb', 'Grass', 'None'] as const;
const WEIGHTS = ['standard', 'bold', 'none'] as const;
const COLORS = ['standard', 'yellow', 'green', 'blue', 'red', 'white', 'orange'] as const;
const LANE_CHANGES = ['increase', 'decrease', 'none', 'both'] as const;

const defaultMark: RoadMark = { s_offset: 0, mark_type: 'Solid', weight: 'standard', color: 'standard', material: 'standard', width: 0.15, lane_change: 'none' };

export function RoadMarkingPanel() {
  const { t } = useTranslation();
  const selectedSceneNode = useProjectStore((s) => s.selectedSceneNode);
  const project = useProjectStore((s) => s.project);

  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [form, setForm] = useState<RoadMark>({ ...defaultMark });

  const laneInfo = useMemo(() => {
    if (selectedSceneNode?.type !== 'lane') return null;
    const { roadId, sectionIndex, side, laneId } = selectedSceneNode;
    const road = project.roads.find((r) => r.id === roadId);
    if (!road) return null;
    const section = road.lane_sections[sectionIndex];
    if (!section) return null;
    const lane = section[side].find((l) => l.id === laneId);
    if (!lane) return null;
    return { roadId, sectionIndex, side, laneId, road, lane };
  }, [selectedSceneNode, project]);

  const sortedMarks = useMemo(() => {
    if (!laneInfo) return [];
    return [...laneInfo.lane.road_marks].sort((a, b) => a.s_offset - b.s_offset);
  }, [laneInfo]);

  const handleAdd = () => {
    if (!laneInfo) return;
    useProjectStore.getState().addRoadMark(laneInfo.roadId, laneInfo.sectionIndex, laneInfo.side, laneInfo.laneId, { ...defaultMark });
  };

  const handleDelete = async (markIndex: number) => {
    if (!laneInfo) return;
    const confirmed = await showConfirm(t('dialog.confirmDeleteMarking', 'Delete this road marking?'));
    if (confirmed) {
      useProjectStore.getState().removeRoadMark(laneInfo.roadId, laneInfo.sectionIndex, laneInfo.side, laneInfo.laneId, markIndex);
    }
  };

  const handleEdit = (mark: RoadMark, index: number) => {
    setForm({ ...mark });
    setEditIndex(index);
  };

  const handleSave = () => {
    if (!laneInfo || editIndex === null) return;
    useProjectStore.getState().updateRoadMark(laneInfo.roadId, laneInfo.sectionIndex, laneInfo.side, laneInfo.laneId, editIndex, form);
    setEditIndex(null);
  };

  const handleCancel = () => {
    setEditIndex(null);
  };

  if (!laneInfo) return null;

  const { sectionIndex, side, laneId, road } = laneInfo;
  const lane = laneInfo.lane;
  const sideLabel = side === 'left' ? 'L' : 'R';

  return (
    <div className="road-marking-panel">
      <div className="rm-info">
        <span>{t('roadMarkings.road')}: {road.id}</span>
        <span>{t('roadMarkings.section')}: #{sectionIndex + 1}</span>
        <span>{t('roadMarkings.lane')}: {sideLabel}{Math.abs(laneId)} ({lane.lane_type})</span>
        <button className="rm-btn rm-btn-add" onClick={handleAdd}>+ {t('roadMarkings.addMarking')}</button>
      </div>

      <div className="rm-list" role="list" aria-label="Road mark list">
        {sortedMarks.map((mark, i) => (
          <div key={i} className="rm-row" data-testid="marking-row" role="listitem">
            <span className="rm-mark-info">
              s={mark.s_offset} {mark.mark_type} {mark.weight} {mark.color}
            </span>
            <span className="rm-row-actions">
              <button className="rm-btn rm-btn-sm" onClick={() => handleEdit(mark, i)}>{t('roadMarkings.edit')}</button>
              <button className="rm-btn rm-btn-sm rm-btn-delete" onClick={() => handleDelete(i)}>{t('roadMarkings.delete')}</button>
            </span>
          </div>
        ))}
      </div>

      {editIndex !== null && (
        <div className="rm-form" role="form" aria-label={t('roadMarkings.edit')}>
          <div className="rm-form-row">
            <label htmlFor="rm-s-offset">{t('roadMarkings.sOffset')}</label>
            <input id="rm-s-offset" className="rm-input" type="number" step="0.1" value={form.s_offset} onChange={(e) => setForm({ ...form, s_offset: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="rm-form-row">
            <label htmlFor="rm-type">{t('roadMarkings.type')}</label>
            <select id="rm-type" className="rm-select" value={form.mark_type} aria-label={t('roadMarkings.type')} onChange={(e) => setForm({ ...form, mark_type: e.target.value })}>
              {MARK_TYPES.map((mt) => <option key={mt} value={mt}>{mt}</option>)}
            </select>
          </div>
          <div className="rm-form-row">
            <label htmlFor="rm-weight">{t('roadMarkings.weight')}</label>
            <select id="rm-weight" className="rm-select" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })}>
              {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div className="rm-form-row">
            <label htmlFor="rm-color">{t('roadMarkings.color')}</label>
            <select id="rm-color" className="rm-select" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}>
              {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="rm-form-row">
            <label htmlFor="rm-width">{t('roadMarkings.width')}</label>
            <input id="rm-width" className="rm-input" type="number" step="0.01" value={form.width} onChange={(e) => setForm({ ...form, width: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="rm-form-row">
            <label htmlFor="rm-lane-change">{t('roadMarkings.laneChange')}</label>
            <select id="rm-lane-change" className="rm-select" value={form.lane_change} onChange={(e) => setForm({ ...form, lane_change: e.target.value })}>
              {LANE_CHANGES.map((lc) => <option key={lc} value={lc}>{lc}</option>)}
            </select>
          </div>
          <div className="rm-form-actions">
            <button className="rm-btn rm-btn-save" onClick={handleSave}>{t('roadMarkings.save')}</button>
            <button className="rm-btn rm-btn-cancel" onClick={handleCancel}>{t('roadMarkings.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
