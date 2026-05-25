import { memo, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Junction, Road } from '../../services/platform';
import { useProjectStore } from '../../stores/projectStore';
import {
  addConnectionBetweenRoads,
  getConnectionOutgoingRoadId,
  getJunctionConnectingRoads,
  getJunctionIncomingRoads,
  getJunctionOutgoingRoads,
} from '../../utils/junctionEditing';

type RoadLookup = Record<string, Road | undefined>;

interface JunctionEditorProps {
  junction: Junction;
}

function formatRoadLabel(road: Road | undefined): string {
  if (!road) {
    return '—';
  }
  return road.name ? `${road.name} (${road.id})` : road.id;
}

const JunctionEditorCard = memo(function JunctionEditorCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="inspector-card">
      <div className="inspector-card-header">
        <span>{title}</span>
      </div>
      <div className="inspector-card-body">{children}</div>
    </div>
  );
});

export const JunctionEditor = memo(function JunctionEditor({ junction }: JunctionEditorProps) {
  const { t } = useTranslation();
  const project = useProjectStore((state) => state.project);
  const updateJunction = useProjectStore((state) => state.updateJunction);
  const removeJunctionConnection = useProjectStore((state) => state.removeJunctionConnection);
  const rebuildJunctionConnections = useProjectStore((state) => state.rebuildJunctionConnections);
  const executePluginCommand = useProjectStore((state) => state.executePluginCommand);

  const [junctionNameDraft, setJunctionNameDraft] = useState(junction.name || '');
  const [selectedIncomingRoadId, setSelectedIncomingRoadId] = useState('');
  const [selectedOutgoingRoadId, setSelectedOutgoingRoadId] = useState('');

  useEffect(() => {
    setJunctionNameDraft(junction.name || '');
  }, [junction.id, junction.name]);

  const roadLookup = useMemo<RoadLookup>(() => Object.fromEntries(project.roads.map((road) => [road.id, road])), [project.roads]);
  const incomingRoads = useMemo(() => getJunctionIncomingRoads(project, junction.id), [project, junction.id]);
  const outgoingRoads = useMemo(() => getJunctionOutgoingRoads(project, junction.id), [project, junction.id]);
  const connectingRoads = useMemo(() => getJunctionConnectingRoads(project, junction.id), [project, junction.id]);
  const connectionRows = useMemo(() => junction.connections.map((connection) => ({
    connection,
    outgoingRoadId: getConnectionOutgoingRoadId(project, connection),
  })), [junction.connections, project]);

  useEffect(() => {
    if (!incomingRoads.some((road) => road.id === selectedIncomingRoadId)) {
      setSelectedIncomingRoadId(incomingRoads[0]?.id ?? '');
    }
  }, [incomingRoads, selectedIncomingRoadId]);

  useEffect(() => {
    if (!outgoingRoads.some((road) => road.id === selectedOutgoingRoadId)) {
      setSelectedOutgoingRoadId(outgoingRoads[0]?.id ?? '');
    }
  }, [outgoingRoads, selectedOutgoingRoadId]);

  const canAddConnection = selectedIncomingRoadId.length > 0
    && selectedOutgoingRoadId.length > 0
    && selectedIncomingRoadId !== selectedOutgoingRoadId
    && !connectionRows.some((row) => (
      row.connection.incoming_road === selectedIncomingRoadId
      && row.outgoingRoadId === selectedOutgoingRoadId
    ));

  const handleAddConnection = () => {
    if (!canAddConnection) {
      return;
    }

    executePluginCommand(
      t('propertyPanel.addConnection', 'Add Connection'),
      (currentProject) => addConnectionBetweenRoads(currentProject, junction.id, selectedIncomingRoadId, selectedOutgoingRoadId),
    );
  };

  return (
    <div className="inspector-cards">
      <JunctionEditorCard title={t('propertyPanel.junctionProperties')}>
        <div className="property-row">
          <span className="property-label">{t('propertyPanel.id')}</span>
          <span className="property-value">{junction.id}</span>
        </div>
        <div className="property-row">
          <span className="property-label">{t('propertyPanel.name')}</span>
          <input
            className="property-input"
            value={junctionNameDraft}
            placeholder="—"
            onChange={(event) => setJunctionNameDraft(event.target.value)}
            onBlur={() => {
              if (junctionNameDraft !== (junction.name || '')) {
                updateJunction(junction.id, { name: junctionNameDraft });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                (event.target as HTMLInputElement).blur();
              }
            }}
          />
        </div>
      </JunctionEditorCard>

      <JunctionEditorCard title={`${t('propertyPanel.incomingRoads', 'Incoming Roads')} (${incomingRoads.length})`}>
        {incomingRoads.length === 0 ? (
          <div className="property-row sub">
            <span className="property-label">{t('propertyPanel.noIncomingRoads', 'No incoming roads attached')}</span>
          </div>
        ) : incomingRoads.map((road) => (
          <div key={road.id} className="property-row sub">
            <span className="property-label">{road.id}</span>
            <span className="property-value">{road.name || '—'}</span>
          </div>
        ))}
      </JunctionEditorCard>

      <JunctionEditorCard title={`${t('propertyPanel.connectingRoads', 'Connecting Roads')} (${connectingRoads.length})`}>
        {connectingRoads.length === 0 ? (
          <div className="property-row sub">
            <span className="property-label">{t('propertyPanel.noConnectingRoads', 'No connecting roads inside this junction')}</span>
          </div>
        ) : connectingRoads.map((road) => (
          <div key={road.id} className="property-row sub">
            <span className="property-label">{road.id}</span>
            <span className="property-value">{road.name || '—'}</span>
          </div>
        ))}
      </JunctionEditorCard>

      <JunctionEditorCard title={`${t('propertyPanel.connectionTable', 'Connection Table')} (${junction.connections.length})`}>
        <div className="junction-editor-controls">
          <div className="junction-editor-selects">
            <select
              className="property-select"
              value={selectedIncomingRoadId}
              onChange={(event) => setSelectedIncomingRoadId(event.target.value)}
            >
              {incomingRoads.length === 0 ? (
                <option value="">{t('propertyPanel.noIncomingRoads', 'No incoming roads attached')}</option>
              ) : incomingRoads.map((road) => (
                <option key={road.id} value={road.id}>{formatRoadLabel(road)}</option>
              ))}
            </select>
            <select
              className="property-select"
              value={selectedOutgoingRoadId}
              onChange={(event) => setSelectedOutgoingRoadId(event.target.value)}
            >
              {outgoingRoads.length === 0 ? (
                <option value="">{t('propertyPanel.noOutgoingRoads', 'No outgoing roads attached')}</option>
              ) : outgoingRoads.map((road) => (
                <option key={road.id} value={road.id}>{formatRoadLabel(road)}</option>
              ))}
            </select>
            <button className="property-btn" disabled={!canAddConnection} onClick={handleAddConnection}>
              {t('propertyPanel.addConnection', 'Add Connection')}
            </button>
            <button className="property-btn" onClick={() => void rebuildJunctionConnections(junction.id)}>
              {t('propertyPanel.rebuildConnections', 'Rebuild Connections')}
            </button>
          </div>
        </div>

        {connectionRows.length === 0 ? (
          <div className="property-row sub">
            <span className="property-label">{t('propertyPanel.connections', 'Connections')}</span>
            <span className="property-value">—</span>
          </div>
        ) : (
          <table className="junction-editor-table">
            <thead>
              <tr>
                <th>{t('propertyPanel.incomingRoad')}</th>
                <th>{t('propertyPanel.connectingRoad')}</th>
                <th>{t('propertyPanel.outgoingRoad', 'Outgoing Road')}</th>
                <th>{t('propertyPanel.contactPoint')}</th>
                <th>{t('propertyPanel.laneLinks')}</th>
                <th>{t('propertyPanel.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {connectionRows.map((row, index) => (
                <tr key={row.connection.id}>
                  <td>{formatRoadLabel(roadLookup[row.connection.incoming_road])}</td>
                  <td>{formatRoadLabel(roadLookup[row.connection.connecting_road])}</td>
                  <td>{formatRoadLabel(row.outgoingRoadId ? roadLookup[row.outgoingRoadId] : undefined)}</td>
                  <td>{row.connection.contact_point}</td>
                  <td>{row.connection.lane_links.length > 0 ? row.connection.lane_links.map((laneLink) => `${laneLink.from}→${laneLink.to}`).join(', ') : '—'}</td>
                  <td>
                    <button className="property-btn property-btn-delete-lane" onClick={() => removeJunctionConnection(junction.id, index)}>
                      {t('propertyPanel.removeConnection', 'Remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </JunctionEditorCard>
    </div>
  );
});
