/**
 * ShapeEditorPanel — lists shape layers, nodes, and ways.
 * Accessible via the plugin's panel contribution.
 */

import React, { useState } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import {
  addShapeLayer,
  deleteShapeLayer,
  toggleShapeLayerVisibility,
  deleteShapeNode,
  deleteShapeWay,
  convertWayToRoad,
} from './shape-editor.plugin';
import type { ShapeLayer } from '../../../services/platform';
import { useTranslation } from 'react-i18next';

const ShapeEditorPanel: React.FC = () => {
  const { t } = useTranslation();
  const project = useProjectStore((s) => s.project);
  const layers = project.shape_layers ?? [];
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null);

  return (
    <div style={{ padding: '8px', fontSize: 13 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <strong>{t('shapeEditor.layers', 'Shape Layers')}</strong>
        <button
          onClick={addShapeLayer}
          style={{ cursor: 'pointer', padding: '2px 8px' }}
          title={t('shapeEditor.addLayer', 'Add Shape Layer')}
        >
          +
        </button>
      </div>

      {layers.length === 0 && (
        <p style={{ color: '#888', fontStyle: 'italic' }}>
          {t('shapeEditor.noLayers', 'No layers. Click + to create one.')}
        </p>
      )}

      {layers.map((layer: ShapeLayer) => (
        <div
          key={layer.id}
          style={{
            border: '1px solid #444',
            borderRadius: 4,
            marginBottom: 6,
            overflow: 'hidden',
          }}
        >
          {/* Layer header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              background: '#2a2a2a',
              cursor: 'pointer',
            }}
            onClick={() =>
              setExpandedLayer((prev) => (prev === layer.id ? null : layer.id))
            }
          >
            <span
              style={{ opacity: layer.visible !== false ? 1 : 0.4, flex: 1 }}
            >
              {layer.name}
            </span>
            <small style={{ color: '#888' }}>
              {layer.nodes.length}N / {layer.ways.length}W
            </small>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleShapeLayerVisibility(layer.id);
              }}
              style={{
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                color: layer.visible !== false ? '#adf' : '#666',
                padding: '0 4px',
              }}
              title={t('shapeEditor.toggleVisibility', 'Toggle visibility')}
            >
              ●
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteShapeLayer(layer.id);
              }}
              style={{
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                color: '#f66',
                padding: '0 4px',
              }}
              title={t('shapeEditor.deleteLayer', 'Delete Layer')}
            >
              ✕
            </button>
          </div>

          {/* Layer body — expanded */}
          {expandedLayer === layer.id && (
            <div style={{ padding: '6px 8px', background: '#1e1e1e' }}>
              {/* Nodes */}
              {layer.nodes.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ color: '#aaa', marginBottom: 2 }}>
                    {t('shapeEditor.nodes', 'Nodes')}
                  </div>
                  {layer.nodes.map((node) => (
                    <div
                      key={node.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '2px 0',
                      }}
                    >
                      <span style={{ color: '#ccc', fontFamily: 'monospace' }}>
                        {node.id} ({node.x.toFixed(1)}, {node.y.toFixed(1)})
                      </span>
                      <button
                        onClick={() => deleteShapeNode(layer.id, node.id)}
                        style={{
                          cursor: 'pointer',
                          background: 'none',
                          border: 'none',
                          color: '#f66',
                          padding: '0 4px',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Ways */}
              {layer.ways.length > 0 && (
                <div>
                  <div style={{ color: '#aaa', marginBottom: 2 }}>
                    {t('shapeEditor.ways', 'Ways')}
                  </div>
                  {layer.ways.map((way) => (
                    <div
                      key={way.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '2px 0',
                      }}
                    >
                      <span style={{ color: '#ccc', fontFamily: 'monospace' }}>
                        {way.id} ({way.node_ids.length} nodes)
                      </span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => convertWayToRoad(layer.id, way.id)}
                          style={{
                            cursor: 'pointer',
                            fontSize: 11,
                            padding: '1px 6px',
                            background: '#334',
                            border: '1px solid #556',
                            color: '#adf',
                            borderRadius: 3,
                          }}
                          title={t('shapeEditor.convertToRoad', 'Convert to Road')}
                        >
                          → Road
                        </button>
                        <button
                          onClick={() => deleteShapeWay(layer.id, way.id)}
                          style={{
                            cursor: 'pointer',
                            background: 'none',
                            border: 'none',
                            color: '#f66',
                            padding: '0 4px',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {layer.nodes.length === 0 && layer.ways.length === 0 && (
                <p style={{ color: '#666', fontStyle: 'italic', margin: 0 }}>
                  {t('shapeEditor.emptyLayer', 'Layer is empty.')}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ShapeEditorPanel;
