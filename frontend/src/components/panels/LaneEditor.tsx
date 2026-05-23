import { useState, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Scissors, Merge, Link2 } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import type { Lane, LaneWidth, LaneSection } from '../../services/platform';
import './LaneEditor.css';

/** All OpenDRIVE 1.6 lane types, grouped by category */
const LANE_TYPE_GROUPS = [
  {
    label: 'common',
    types: ['Driving', 'Shoulder', 'Sidewalk', 'Parking', 'Biking', 'Border', 'Stop', 'None'],
  },
  {
    label: 'transit',
    types: ['Bus', 'Taxi', 'HOV', 'Rail', 'Tram'],
  },
  {
    label: 'ramp',
    types: ['Entry', 'Exit', 'OnRamp', 'OffRamp', 'ConnectingRamp'],
  },
  {
    label: 'special',
    types: ['Median', 'Curb', 'Restricted', 'Bidirectional', 'RoadWorks', 'Special1', 'Special2', 'Special3'],
  },
] as const;

interface LaneEditorProps {
  roadId: string;
  laneSections: LaneSection[];
  roadLength: number;
}

interface LaneRowProps {
  roadId: string;
  sectionIndex: number;
  side: 'left' | 'right';
  lane: Lane;
}

const LaneRow = memo(function LaneRow({ roadId, sectionIndex, side, lane }: LaneRowProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const laneWidth = lane.width[0] ?? { s_offset: 0, a: 3.5, b: 0, c: 0, d: 0 };
  const hasVariableWidth = laneWidth.b !== 0 || laneWidth.c !== 0 || laneWidth.d !== 0;

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    useProjectStore.getState().updateLaneType(roadId, sectionIndex, side, lane.id, e.target.value);
  }, [roadId, sectionIndex, side, lane.id]);

  const handleWidthChange = useCallback((field: keyof LaneWidth, value: number) => {
    const updated: LaneWidth = { ...laneWidth, [field]: value };
    useProjectStore.getState().updateLaneWidth(roadId, sectionIndex, side, lane.id, updated);
  }, [roadId, sectionIndex, side, lane.id, laneWidth]);

  const handleDelete = useCallback(() => {
    useProjectStore.getState().removeLane(roadId, sectionIndex, side, lane.id);
  }, [roadId, sectionIndex, side, lane.id]);

  return (
    <div className="lane-editor-row">
      <div className="lane-editor-row-main">
        <span className="lane-editor-id" title={`${side} lane ${Math.abs(lane.id)}`}>
          {side === 'left' ? 'L' : 'R'}{Math.abs(lane.id)}
        </span>
        <select
          className="lane-editor-type-select"
          value={lane.lane_type}
          onChange={handleTypeChange}
        >
          {LANE_TYPE_GROUPS.map((group) => (
            <optgroup key={group.label} label={t(`laneEditor.group.${group.label}`)}>
              {group.types.map((ltype) => (
                <option key={ltype} value={ltype}>{ltype}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <input
          className="lane-editor-width-input"
          type="number"
          step="0.1"
          min="0.1"
          max="30"
          value={laneWidth.a}
          title={t('laneEditor.constantWidth')}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val >= 0.1 && val <= 30) {
              handleWidthChange('a', val);
            }
          }}
        />
        <span className="lane-editor-unit">m</span>
        <button
          className={`lane-editor-btn-adv ${hasVariableWidth ? 'active' : ''}`}
          title={t('laneEditor.variableWidth')}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
        <button
          className="lane-editor-btn-delete"
          title={t('propertyPanel.deleteLane')}
          onClick={handleDelete}
        >
          ×
        </button>
      </div>

      {showAdvanced && (
        <div className="lane-editor-advanced">
          <div className="lane-editor-poly-row">
            <label className="lane-editor-poly-label" title="width(s) = a + b·ds + c·ds² + d·ds³">
              {t('laneEditor.polynomial')}
            </label>
          </div>
          <div className="lane-editor-poly-row">
            <span className="lane-editor-poly-coeff">b</span>
            <input
              className="lane-editor-poly-input"
              type="number"
              step="0.001"
              value={laneWidth.b}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) handleWidthChange('b', val);
              }}
            />
            <span className="lane-editor-poly-coeff">c</span>
            <input
              className="lane-editor-poly-input"
              type="number"
              step="0.0001"
              value={laneWidth.c}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) handleWidthChange('c', val);
              }}
            />
            <span className="lane-editor-poly-coeff">d</span>
            <input
              className="lane-editor-poly-input"
              type="number"
              step="0.00001"
              value={laneWidth.d}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) handleWidthChange('d', val);
              }}
            />
          </div>
          {lane.link && (
            <div className="lane-editor-link-row">
              <Link2 size={10} />
              <span className="lane-editor-link-label">
                {t('laneEditor.predecessor')}: {lane.link.predecessor ?? '—'}
              </span>
              <span className="lane-editor-link-label">
                {t('laneEditor.successor')}: {lane.link.successor ?? '—'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

interface LaneSectionBlockProps {
  roadId: string;
  section: LaneSection;
  sectionIndex: number;
  totalSections: number;
  roadLength: number;
}

const LaneSectionBlock = memo(function LaneSectionBlock({
  roadId,
  section,
  sectionIndex,
  totalSections,
  roadLength,
}: LaneSectionBlockProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [splitS, setSplitS] = useState('');

  const handleSplit = useCallback(() => {
    const sValue = parseFloat(splitS);
    if (isNaN(sValue) || sValue <= section.s || sValue >= roadLength) return;
    // Use executePluginCommand for lane section split
    useProjectStore.getState().executePluginCommand(
      t('laneEditor.splitSection'),
      (project) => ({
        ...project,
        roads: project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          const current = sections[sectionIndex];
          if (!current) return r;
          // Create new section as clone of current starting at splitS
          const cloneLanes = (lanes: Lane[]): Lane[] =>
            lanes.map((l) => ({
              ...l,
              width: [{ s_offset: 0, a: l.width[0]?.a ?? 3.5, b: l.width[0]?.b ?? 0, c: l.width[0]?.c ?? 0, d: l.width[0]?.d ?? 0 }],
            }));
          const newSection: LaneSection = {
            s: sValue,
            single_side: current.single_side,
            left: cloneLanes(current.left),
            center: current.center.map((l) => ({ ...l })),
            right: cloneLanes(current.right),
          };
          sections.splice(sectionIndex + 1, 0, newSection);
          return { ...r, lane_sections: sections };
        }),
      }),
    );
    setSplitS('');
  }, [roadId, sectionIndex, section.s, roadLength, splitS, t]);

  const handleMergeNext = useCallback(() => {
    if (sectionIndex >= totalSections - 1) return;
    useProjectStore.getState().executePluginCommand(
      t('laneEditor.mergeSections'),
      (project) => ({
        ...project,
        roads: project.roads.map((r) => {
          if (r.id !== roadId) return r;
          const sections = [...r.lane_sections];
          // Merge next section into current (keep current lanes, drop next)
          sections.splice(sectionIndex + 1, 1);
          return { ...r, lane_sections: sections };
        }),
      }),
    );
  }, [roadId, sectionIndex, totalSections, t]);

  const handleAddLane = useCallback((side: 'left' | 'right') => {
    useProjectStore.getState().addLane(roadId, sectionIndex, side);
  }, [roadId, sectionIndex]);

  const totalLanes = section.left.length + section.right.length;

  return (
    <div className="lane-section-block">
      <div className="lane-section-header">
        <span className="lane-section-toggle" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        </span>
        <span className="lane-section-title" onClick={() => setCollapsed(!collapsed)}>
          {t('propertyPanel.laneSection')} #{sectionIndex + 1}
        </span>
        <span className="lane-section-meta" onClick={() => setCollapsed(!collapsed)}>
          s={section.s.toFixed(1)} · {totalLanes} {t('propertyPanel.lanes').toLowerCase()}
        </span>
        <div className="lane-section-header-actions">
          <button
            className="lane-section-header-btn"
            onClick={(e) => { e.stopPropagation(); handleAddLane('left'); }}
            title={t('laneEditor.addLeftLane')}
          >
            +L
          </button>
          <button
            className="lane-section-header-btn"
            onClick={(e) => { e.stopPropagation(); handleAddLane('right'); }}
            title={t('laneEditor.addRightLane')}
          >
            +R
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="lane-section-body">
          {/* Left lanes */}
          {section.left.length > 0 && (
            <div className="lane-side-group">
              <span className="lane-side-label">{t('laneEditor.leftSide')} ({section.left.length})</span>
              {section.left.map((lane) => (
                <LaneRow
                  key={`left-${lane.id}`}
                  roadId={roadId}
                  sectionIndex={sectionIndex}
                  side="left"
                  lane={lane}
                />
              ))}
            </div>
          )}

          {/* Right lanes */}
          {section.right.length > 0 && (
            <div className="lane-side-group">
              <span className="lane-side-label">{t('laneEditor.rightSide')} ({section.right.length})</span>
              {section.right.map((lane) => (
                <LaneRow
                  key={`right-${lane.id}`}
                  roadId={roadId}
                  sectionIndex={sectionIndex}
                  side="right"
                  lane={lane}
                />
              ))}
            </div>
          )}

          {/* Split / Merge */}
          <div className="lane-section-ops">
            <div className="lane-section-split">
              <Scissors size={11} />
              <input
                className="lane-editor-split-input"
                type="number"
                step="0.5"
                min={section.s + 0.1}
                placeholder="s"
                value={splitS}
                onChange={(e) => setSplitS(e.target.value)}
              />
              <button
                className="lane-editor-btn lane-editor-btn-split"
                onClick={handleSplit}
                disabled={!splitS}
                title={t('laneEditor.splitSection')}
              >
                {t('laneEditor.split')}
              </button>
            </div>
            {sectionIndex < totalSections - 1 && (
              <button
                className="lane-editor-btn lane-editor-btn-merge"
                onClick={handleMergeNext}
                title={t('laneEditor.mergeSections')}
              >
                <Merge size={11} />
                {t('laneEditor.mergeNext')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export const LaneEditor = memo(function LaneEditor({ roadId, laneSections, roadLength }: LaneEditorProps) {
  return (
    <div className="lane-editor">
      {laneSections.map((ls, si) => (
        <LaneSectionBlock
          key={`${si}-${ls.s}`}
          roadId={roadId}
          section={ls}
          sectionIndex={si}
          totalSections={laneSections.length}
          roadLength={roadLength}
        />
      ))}
    </div>
  );
});
