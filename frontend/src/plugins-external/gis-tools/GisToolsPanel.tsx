/**
 * External GIS Tools panel — coordinate-system converter.
 *
 * Rendered by the host with the shared React instance (see sharedRuntime). All
 * coordinate math is delegated to the host WASM engine via ctx.gis, so this
 * bundle contains no direct WASM import (sandbox-safe).
 */

import { useState, useCallback } from 'react';
import type { ReactElement } from 'react';
import type { PluginGis } from '../sdk';

type CrsSystem = 'WGS84' | 'GCJ-02' | 'UTM' | 'ECEF' | 'MGRS';

interface ConversionResult {
  label: string;
  value: string;
}

function getInputLabels(crs: CrsSystem): [string, string, string] {
  switch (crs) {
    case 'UTM': return ['Easting', 'Northing', 'Zone'];
    case 'ECEF': return ['X (m)', 'Y (m)', 'Z (m)'];
    default: return ['Latitude', 'Longitude', 'Altitude'];
  }
}

/** Build the panel component, closing over the host GIS API. */
export function createGisToolsPanel(gis: PluginGis): () => ReactElement {
  return function GisToolsPanel() {
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
        const lat = parseFloat(inputLat);
        const lon = parseFloat(inputLon);
        const alt = parseFloat(inputAlt);

        if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(alt)) {
          setError('Invalid coordinate input');
          return;
        }

        const output: ConversionResult[] = [];

        if (sourceCrs === 'WGS84' && targetCrs === 'GCJ-02') {
          const r = await gis.wgs84ToGcj02(lat, lon, alt);
          output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
          output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
          output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
        } else if (sourceCrs === 'GCJ-02' && targetCrs === 'WGS84') {
          const r = await gis.gcj02ToWgs84(lat, lon, alt);
          output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
          output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
          output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
        } else if (sourceCrs === 'WGS84' && targetCrs === 'UTM') {
          const r = await gis.geoToUtm(lat, lon, alt);
          output.push({ label: 'Easting', value: r.easting.toFixed(3) + ' m' });
          output.push({ label: 'Northing', value: r.northing.toFixed(3) + ' m' });
          output.push({ label: 'Zone', value: `${r.zone}${r.is_northern ? 'N' : 'S'}` });
          output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
        } else if (sourceCrs === 'UTM' && targetCrs === 'WGS84') {
          const zone = parseInt(inputAlt, 10) || 50;
          const r = await gis.utmToGeo(lat, lon, zone, true, 0);
          output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
          output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
          output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
        } else if (sourceCrs === 'WGS84' && targetCrs === 'ECEF') {
          const r = await gis.geodeticToEcef(lat, lon, alt);
          output.push({ label: 'X', value: r.x.toFixed(3) + ' m' });
          output.push({ label: 'Y', value: r.y.toFixed(3) + ' m' });
          output.push({ label: 'Z', value: r.z.toFixed(3) + ' m' });
        } else if (sourceCrs === 'ECEF' && targetCrs === 'WGS84') {
          const r = await gis.ecefToGeodetic(lat, lon, alt);
          output.push({ label: 'Latitude', value: r.lat.toFixed(8) });
          output.push({ label: 'Longitude', value: r.lon.toFixed(8) });
          output.push({ label: 'Altitude', value: r.alt.toFixed(3) + ' m' });
        } else if (sourceCrs === 'WGS84' && targetCrs === 'MGRS') {
          const r = await gis.geoToMgrs(lat, lon, 5);
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
  };
}
