import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import type { Road } from '../../services/platform';
import { computeCrossSection, type CrossSectionLane } from './crossSectionLayout';
import './CrossSectionEditor.css';

interface CrossSectionEditorProps {
  road: Road;
}

/** Fill colors per lane type (kept in sync with the viewport surface palette). */
const LANE_FILL: Record<string, string> = {
  Driving: '#5a5a62',
  Shoulder: '#4d4d4a',
  Sidewalk: '#8c8c80',
  Parking: '#3d5a3d',
  Biking: '#3d4d5a',
  Border: '#6a6a55',
  Median: '#55503d',
  Stop: '#7a3d3d',
  None: '#444',
};

const SVG_W = 280;
const SVG_H = 90;
const LANE_H = 44;
const MARGIN = 8;

type SelectedLane = { side: 'left' | 'right'; id: number };

export function CrossSectionEditor({ road }: CrossSectionEditorProps) {
  const { t } = useTranslation();
  const [station, setStation] = useState(0);
  const [selected, setSelected] = useState<SelectedLane | null>(null);

  const cross = useMemo(() => computeCrossSection(road, station), [road, station]);

  const totalWidth = Math.max(cross.totalLeft + cross.totalRight, 1);
  const scale = (SVG_W - 2 * MARGIN) / totalWidth;
  const centerX = MARGIN + cross.totalLeft * scale;
  const laneY = (SVG_H - LANE_H) / 2;

  const rectFor = (lane: CrossSectionLane) => {
    const x = lane.side === 'left'
      ? centerX - lane.outer * scale
      : centerX + lane.inner * scale;
    return { x, width: Math.max((lane.outer - lane.inner) * scale, 1) };
  };

  const selectLane = (lane: CrossSectionLane) => {
    setSelected({ side: lane.side, id: lane.id });
    useProjectStore.getState().selectLane(road.id, cross.sectionIndex, lane.side, lane.id);
  };

  const selectedLane = selected
    ? cross.lanes.find((l) => l.side === selected.side && l.id === selected.id) ?? null
    : null;

  const setSelectedWidth = (value: number) => {
    if (!selectedLane || Number.isNaN(value) || value <= 0) return;
    useProjectStore.getState().updateLaneWidth(
      road.id, cross.sectionIndex, selectedLane.side, selectedLane.id,
      { s_offset: 0, a: value, b: 0, c: 0, d: 0 },
    );
  };

  const addLane = (side: 'left' | 'right') => {
    useProjectStore.getState().addLane(road.id, cross.sectionIndex, side);
  };

  const removeSelected = () => {
    if (!selectedLane) return;
    useProjectStore.getState().removeLane(road.id, cross.sectionIndex, selectedLane.side, selectedLane.id);
    setSelected(null);
  };

  return (
    <div className="cross-section-editor">
      <div className="property-row">
        <span className="property-label">{t('crossSection.station')}</span>
        <input
          className="cross-section-slider"
          type="range"
          min={0}
          max={Math.max(road.length, 0)}
          step={Math.max(road.length / 200, 0.1)}
          value={station}
          aria-label={t('crossSection.station')}
          data-testid="cross-section-station"
          onChange={(e) => setStation(parseFloat(e.target.value) || 0)}
        />
        <span className="property-value">{station.toFixed(1)} m</span>
      </div>

      <svg
        className="cross-section-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        role="img"
        aria-label={t('crossSection.title')}
      >
        {/* Ground line */}
        <line x1={0} y1={laneY + LANE_H} x2={SVG_W} y2={laneY + LANE_H} className="cross-section-ground" />
        {cross.lanes.map((lane) => {
          const { x, width } = rectFor(lane);
          const isSel = selected?.side === lane.side && selected.id === lane.id;
          return (
            <g key={`${lane.side}-${lane.id}`} onClick={() => selectLane(lane)} className="cross-section-lane">
              <rect
                x={x}
                y={laneY}
                width={width}
                height={LANE_H}
                fill={LANE_FILL[lane.laneType] ?? LANE_FILL.None}
                stroke={isSel ? '#4da3ff' : '#222'}
                strokeWidth={isSel ? 2 : 0.5}
                data-testid={`cross-section-lane-${lane.side}-${lane.id}`}
              />
              {width > 14 && (
                <text x={x + width / 2} y={laneY + LANE_H / 2 + 3} textAnchor="middle" className="cross-section-label">
                  {lane.id}
                </text>
              )}
            </g>
          );
        })}
        {/* Center reference line */}
        <line x1={centerX} y1={laneY - 4} x2={centerX} y2={laneY + LANE_H + 4} className="cross-section-center" />
      </svg>

      <div className="property-row">
        <button className="property-btn" data-testid="cross-section-add-left" onClick={() => addLane('left')}>
          {t('crossSection.addLeft')}
        </button>
        <button className="property-btn" data-testid="cross-section-add-right" onClick={() => addLane('right')}>
          {t('crossSection.addRight')}
        </button>
      </div>

      {selectedLane ? (
        <div className="property-row">
          <span className="property-label">{t('crossSection.selectedWidth', { id: selectedLane.id })}</span>
          <input
            className="property-input property-input-narrow"
            type="number"
            min="0.1"
            step="0.1"
            value={Number(selectedLane.width.toFixed(3))}
            aria-label={t('crossSection.selectedWidth', { id: selectedLane.id })}
            data-testid="cross-section-width"
            onChange={(e) => setSelectedWidth(parseFloat(e.target.value))}
          />
          <button className="property-btn property-btn-danger" data-testid="cross-section-remove" onClick={removeSelected}>
            {t('crossSection.remove')}
          </button>
        </div>
      ) : (
        <div className="property-row">
          <span className="property-hint">{t('crossSection.selectHint')}</span>
        </div>
      )}
    </div>
  );
}
