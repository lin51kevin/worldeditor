import { useMemo } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import { autoDeploySignals, computeTrafficPhases } from './trafficUtils';
import './TrafficPanel.css';

export default function TrafficPanel() {
  const project = useProjectStore((state) => state.project);
  const setProject = useProjectStore((state) => state.setProject);

  const signalCount = useMemo(
    () => project.roads.reduce((count, road) => count + (road.signals?.length ?? 0), 0),
    [project],
  );
  const phases = useMemo(() => computeTrafficPhases(project), [project]);

  return (
    <div className="traffic-panel">
      <h3 className="traffic-panel__title">Traffic Control</h3>

      <div className="traffic-panel__stats">
        <div><strong>Roads</strong><span>{project.roads.length}</span></div>
        <div><strong>Junctions</strong><span>{project.junctions.length}</span></div>
        <div><strong>Signals</strong><span>{signalCount}</span></div>
        <div><strong>Phase Plans</strong><span>{phases.length}</span></div>
      </div>

      <div className="traffic-panel__actions">
        <button type="button" onClick={() => setProject(autoDeploySignals(project))}>Auto-Deploy Signals</button>
      </div>

      <div className="traffic-panel__list">
        {phases.length === 0 ? (
          <div className="traffic-panel__empty">No phase suggestions yet. Deploy signals or import a SUMO network.</div>
        ) : phases.map((phase) => (
          <div className="traffic-panel__card" key={phase.id}>
            <div className="traffic-panel__card-title">{phase.label}</div>
            <div className="traffic-panel__card-row"><span>Roads</span><span>{phase.roadIds.join(', ')}</span></div>
            <div className="traffic-panel__card-row"><span>Signals</span><span>{phase.signalIds.length}</span></div>
            <div className="traffic-panel__card-row"><span>Cycle</span><span>{phase.cycleSeconds}s</span></div>
            <div className="traffic-panel__card-row"><span>Green / Yellow / Red</span><span>{phase.greenSeconds}s / {phase.yellowSeconds}s / {phase.redSeconds}s</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}