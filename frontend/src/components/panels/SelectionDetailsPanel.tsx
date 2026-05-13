import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';

/**
 * A compact read-only summary panel showing the currently selected element.
 * Intended for the status bar or a small floating overlay.
 */
export function SelectionDetailsPanel() {
  const { t } = useTranslation();

  const selectedRoadId = useEditorStore((s) => s.selectedRoadId);
  const selectedJunctionId = useEditorStore((s) => s.selectedJunctionId);
  const project = useEditorStore((s) => s.project);

  const selectedRoad = selectedRoadId
    ? project.roads.find((r) => r.id === selectedRoadId)
    : null;
  const selectedJunction = selectedJunctionId
    ? project.junctions.find((j) => j.id === selectedJunctionId)
    : null;

  if (selectedRoad) {
    const lanes = selectedRoad.lane_sections.reduce(
      (acc, ls) => acc + ls.left.length + ls.right.length,
      0,
    );
    return (
      <div className="selection-details" data-testid="selection-details">
        <span className="selection-details-type">{t('selection.road', 'Road')}</span>
        <span className="selection-details-id">{selectedRoad.id}</span>
        {selectedRoad.name && (
          <span className="selection-details-name">{selectedRoad.name}</span>
        )}
        <span className="selection-details-length">
          {selectedRoad.length.toFixed(1)} m
        </span>
        <span className="selection-details-lanes">
          {t('selection.lanes', '{{n}} lanes', { n: lanes })}
        </span>
      </div>
    );
  }

  if (selectedJunction) {
    return (
      <div className="selection-details" data-testid="selection-details">
        <span className="selection-details-type">{t('selection.junction', 'Junction')}</span>
        <span className="selection-details-id">{selectedJunction.id}</span>
        {selectedJunction.name && (
          <span className="selection-details-name">{selectedJunction.name}</span>
        )}
        <span className="selection-details-connections">
          {t('selection.connections', '{{n}} connections', {
            n: selectedJunction.connections.length,
          })}
        </span>
      </div>
    );
  }

  return (
    <div className="selection-details selection-details-empty" data-testid="selection-details">
      <span className="selection-details-placeholder">
        {t('selection.noSelection', 'No selection')}
      </span>
    </div>
  );
}
