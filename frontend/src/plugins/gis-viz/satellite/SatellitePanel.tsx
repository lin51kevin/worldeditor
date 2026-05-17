import { useSatelliteOverlayStore, type SatelliteStyle } from './satelliteState';
import './SatellitePanel.css';

const STYLE_OPTIONS: Array<{ value: SatelliteStyle; label: string }> = [
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'survey', label: 'Survey' },
  { value: 'mono', label: 'Mono' },
];

export default function SatellitePanel() {
  const enabled = useSatelliteOverlayStore((state) => state.enabled);
  const opacity = useSatelliteOverlayStore((state) => state.opacity);
  const style = useSatelliteOverlayStore((state) => state.style);
  const setEnabled = useSatelliteOverlayStore((state) => state.setEnabled);
  const setOpacity = useSatelliteOverlayStore((state) => state.setOpacity);
  const setStyle = useSatelliteOverlayStore((state) => state.setStyle);

  return (
    <div className="satellite-panel">
      <h3 className="satellite-panel__title">Viewport Basemap</h3>
      <label className="satellite-panel__toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span>Enable basemap overlay</span>
      </label>

      <label className="satellite-panel__field">
        <span>Style</span>
        <select value={style} onChange={(event) => setStyle(event.target.value as SatelliteStyle)}>
          {STYLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="satellite-panel__field">
        <span>Opacity</span>
        <input type="range" min="0.1" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
      </label>

      <div className="satellite-panel__preview">
        <div className={`satellite-panel__swatch satellite-panel__swatch--${style}`} style={{ opacity }} />
        <div className="satellite-panel__caption">Applies as a lightweight overlay behind the road network.</div>
      </div>
    </div>
  );
}