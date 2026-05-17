import { useState, useCallback } from 'react';
import './GisToolsPanel.css';

type CrsSystem = 'WGS84' | 'GCJ-02' | 'UTM' | 'ECEF' | 'MGRS';

interface ConversionResult {
  label: string;
  value: string;
}

let wasmPromise: Promise<typeof import('../../../../wasm/pkg/we_wasm')> | null = null;
function getWasm() {
  if (!wasmPromise) {
    wasmPromise = import('../../../../wasm/pkg/we_wasm');
  }
  return wasmPromise;
}

export default function GisToolsPanel() {
  const [sourceCrs, setSourceCrs] = useState<CrsSystem>('WGS84');
  const [targetCrs, setTargetCrs] = useState<CrsSystem>('UTM');
  const [inputLat, setInputLat] = useState('39.9042');
  const [inputLon, setInputLon] = useState('116.4074');
  const [inputAlt, setInputAlt] = useState('0');
  const [results, setResults] = useState<ConversionResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const convert = useCallback(async () => {
    setError(null);
    setResults([]);
    try {
      const wasm = await getWasm();
      const lat = parseFloat(inputLat);
      const lon = parseFloat(inputLon);
      const alt = parseFloat(inputAlt);

      if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(alt)) {
        setError('Invalid coordinate input');
        return;
      }

      const output: ConversionResult[] = [];

      if (sourceCrs === 'WGS84' && targetCrs === 'GCJ-02') {
        const r = wasm.wgs84_to_gcj02(lat, lon, alt) as { lat: number; lon: number; alt: number };
        output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
        output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
        output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
      } else if (sourceCrs === 'GCJ-02' && targetCrs === 'WGS84') {
        const r = wasm.gcj02_to_wgs84(lat, lon, alt) as { lat: number; lon: number; alt: number };
        output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
        output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
        output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
      } else if (sourceCrs === 'WGS84' && targetCrs === 'UTM') {
        const r = wasm.geo_to_utm(lat, lon, alt) as { easting: number; northing: number; zone: number; is_northern: boolean; alt: number };
        output.push({ label: 'Easting', value: r.easting.toFixed(3) + ' m' });
        output.push({ label: 'Northing', value: r.northing.toFixed(3) + ' m' });
        output.push({ label: 'Zone', value: `${r.zone}${r.is_northern ? 'N' : 'S'}` });
        output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
      } else if (sourceCrs === 'UTM' && targetCrs === 'WGS84') {
        // For UTM→WGS84, lat=easting, lon=northing, alt=zone (repurpose inputs)
        const zone = parseInt(inputAlt, 10) || 50;
        const r = wasm.utm_to_geo(lat, lon, zone, true, 0) as { lat: number; lon: number; alt: number };
        output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
        output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
        output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
      } else if (sourceCrs === 'WGS84' && targetCrs === 'ECEF') {
        const r = wasm.geodetic_to_ecef(lat, lon, alt) as { x: number; y: number; z: number };
        output.push({ label: 'X', value: r.x.toFixed(3) + ' m' });
        output.push({ label: 'Y', value: r.y.toFixed(3) + ' m' });
        output.push({ label: 'Z', value: r.z.toFixed(3) + ' m' });
      } else if (sourceCrs === 'ECEF' && targetCrs === 'WGS84') {
        const r = wasm.ecef_to_geodetic(lat, lon, alt) as { lat: number; lon: number; alt: number };
        output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
        output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
        output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
      } else if (sourceCrs === 'WGS84' && targetCrs === 'MGRS') {
        const r = wasm.geo_to_mgrs(lat, lon, 5);
        output.push({ label: 'MGRS', value: r });
      } else {
        setError(`Conversion ${sourceCrs} → ${targetCrs} not supported. Convert to WGS84 first.`);
        return;
      }

      setResults(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sourceCrs, targetCrs, inputLat, inputLon, inputAlt]);

  const crsOptions: CrsSystem[] = ['WGS84', 'GCJ-02', 'UTM', 'ECEF', 'MGRS'];

  const inputLabels = getInputLabels(sourceCrs);

  return (
    <div className="gis-tools-panel">
      <h3 className="gis-tools-title">Coordinate Converter</h3>

      <div className="gis-tools-crs-row">
        <label>
          Source
          <select value={sourceCrs} onChange={(e) => setSourceCrs(e.target.value as CrsSystem)}>
            {crsOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <span className="gis-tools-arrow">→</span>
        <label>
          Target
          <select value={targetCrs} onChange={(e) => setTargetCrs(e.target.value as CrsSystem)}>
            {crsOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <div className="gis-tools-inputs">
        <label>
          {inputLabels[0]}
          <input type="text" value={inputLat} onChange={(e) => setInputLat(e.target.value)} />
        </label>
        <label>
          {inputLabels[1]}
          <input type="text" value={inputLon} onChange={(e) => setInputLon(e.target.value)} />
        </label>
        <label>
          {inputLabels[2]}
          <input type="text" value={inputAlt} onChange={(e) => setInputAlt(e.target.value)} />
        </label>
      </div>

      <button className="gis-tools-convert-btn" onClick={() => { void convert(); }}>
        Convert
      </button>

      {error && <div className="gis-tools-error">{error}</div>}

      {results.length > 0 && (
        <div className="gis-tools-results">
          {results.map((r) => (
            <div className="gis-tools-result-row" key={r.label}>
              <span className="gis-tools-result-label">{r.label}</span>
              <span className="gis-tools-result-value">{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getInputLabels(crs: CrsSystem): [string, string, string] {
  switch (crs) {
    case 'UTM': return ['Easting', 'Northing', 'Zone'];
    case 'ECEF': return ['X (m)', 'Y (m)', 'Z (m)'];
    default: return ['Latitude', 'Longitude', 'Altitude'];
  }
}
