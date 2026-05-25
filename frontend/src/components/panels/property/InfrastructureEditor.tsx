import { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../../stores/projectStore';

interface InfrastructureItem {
  id: string;
  s: number;
  length: number;
  bridge_type?: string;
  tunnel_type?: string;
}

interface InfrastructureEditorProps {
  type: 'bridge' | 'tunnel';
  items: InfrastructureItem[];
  roadId: string;
  typeOptions: readonly string[];
}

export const InfrastructureEditor = memo(function InfrastructureEditor({
  type,
  items,
  roadId,
  typeOptions,
}: InfrastructureEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Array<{ s: string; length: string }>>([]);

  useEffect(() => {
    setDraft(items.map((item) => ({ s: String(item.s), length: String(item.length) })));
  }, [items]);

  const typeField = type === 'bridge' ? 'bridge_type' : 'tunnel_type';
  const arrayField = type === 'bridge' ? 'bridges' : 'tunnels';
  const deleteLabel = type === 'bridge'
    ? t('propertyPanel.deleteBridge', 'Delete Bridge')
    : t('propertyPanel.deleteTunnel', 'Delete Tunnel');
  const updateLabel = type === 'bridge'
    ? t('propertyPanel.updateBridge', 'Update Bridge')
    : t('propertyPanel.updateTunnel', 'Update Tunnel');

  return (
    <>
      {items.map((item, idx) => (
        <div key={item.id} className="property-lane-section">
          <div className="property-row sub">
            <span className="property-label">{item.id}</span>
            <button
              className="property-btn property-btn-delete-lane"
              title={deleteLabel}
              onClick={() =>
                useProjectStore.getState().executePluginCommand(
                  deleteLabel,
                  (p) => ({
                    ...p,
                    roads: p.roads.map((r) =>
                      r.id !== roadId
                        ? r
                        : { ...r, [arrayField]: (r[arrayField] ?? []).filter((_: unknown, i: number) => i !== idx) },
                    ),
                  }),
                )
              }
            >
              ×
            </button>
          </div>
          <div className="property-row sub lane-row">
            <span className="property-label">s (m)</span>
            <input
              className="property-input property-input-narrow"
              type="number"
              step="0.1"
              min="0"
              value={draft[idx]?.s ?? String(item.s)}
              onChange={(e) =>
                setDraft((prev) =>
                  prev.map((d, i) => i !== idx ? d : { ...d, s: e.target.value }),
                )
              }
              onBlur={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0) {
                  useProjectStore.getState().executePluginCommand(
                    updateLabel,
                    (p) => ({
                      ...p,
                      roads: p.roads.map((r) =>
                        r.id !== roadId ? r : {
                          ...r,
                          [arrayField]: (r[arrayField] ?? []).map((x: InfrastructureItem, i: number) =>
                            i !== idx ? x : { ...x, s: val },
                          ),
                        },
                      ),
                    }),
                  );
                }
              }}
            />
            <span className="property-label">len (m)</span>
            <input
              className="property-input property-input-narrow"
              type="number"
              step="0.1"
              min="0.1"
              value={draft[idx]?.length ?? String(item.length)}
              onChange={(e) =>
                setDraft((prev) =>
                  prev.map((d, i) => i !== idx ? d : { ...d, length: e.target.value }),
                )
              }
              onBlur={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val > 0) {
                  useProjectStore.getState().executePluginCommand(
                    updateLabel,
                    (p) => ({
                      ...p,
                      roads: p.roads.map((r) =>
                        r.id !== roadId ? r : {
                          ...r,
                          [arrayField]: (r[arrayField] ?? []).map((x: InfrastructureItem, i: number) =>
                            i !== idx ? x : { ...x, length: val },
                          ),
                        },
                      ),
                    }),
                  );
                }
              }}
            />
          </div>
          <div className="property-row sub lane-row">
            <span className="property-label">{t('propertyPanel.type', 'Type')}</span>
            <select
              className="property-select property-select-lane"
              value={(item as unknown as Record<string, string>)[typeField] ?? typeOptions[0]}
              onChange={(e) =>
                useProjectStore.getState().executePluginCommand(
                  updateLabel,
                  (p) => ({
                    ...p,
                    roads: p.roads.map((r) =>
                      r.id !== roadId ? r : {
                        ...r,
                        [arrayField]: (r[arrayField] ?? []).map((x: InfrastructureItem, i: number) =>
                          i !== idx ? x : { ...x, [typeField]: e.target.value },
                        ),
                      },
                    ),
                  }),
                )
              }
            >
              {typeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </>
  );
});
