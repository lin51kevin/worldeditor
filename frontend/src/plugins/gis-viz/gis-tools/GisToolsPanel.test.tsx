import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GisToolsPanel from './GisToolsPanel';

// Mock the WASM module — same relative path used by the source file.
vi.mock('../../../../wasm/pkg/we_wasm', () => ({
  wgs84_to_gcj02: vi.fn().mockReturnValue({ lat: 39.90887766, lon: 116.41354321, alt: 0 }),
  gcj02_to_wgs84: vi.fn().mockReturnValue({ lat: 39.90000000, lon: 116.40000000, alt: 0 }),
  geo_to_utm: vi.fn().mockReturnValue({ easting: 448251.123, northing: 4415584.456, zone: 50, is_northern: true, alt: 0 }),
  utm_to_geo: vi.fn().mockReturnValue({ lat: 39.90000000, lon: 116.40000000, alt: 0 }),
  geodetic_to_ecef: vi.fn().mockReturnValue({ x: -2175568.123, y: 4391476.456, z: 4076600.789 }),
  ecef_to_geodetic: vi.fn().mockReturnValue({ lat: 39.90000000, lon: 116.40000000, alt: 0 }),
  geo_to_mgrs: vi.fn().mockReturnValue('50SMG4825115584'),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GisToolsPanel', () => {
  it('renders "Coordinate Converter" title', () => {
    render(<GisToolsPanel />);
    expect(screen.getByText('Coordinate Converter')).toBeInTheDocument();
  });

  it('renders Source and Target CRS selects', () => {
    render(<GisToolsPanel />);
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Target')).toBeInTheDocument();
  });

  it('default source CRS is WGS84', () => {
    render(<GisToolsPanel />);
    const selects = screen.getAllByRole('combobox');
    expect((selects[0] as HTMLSelectElement).value).toBe('WGS84');
  });

  it('default target CRS is UTM', () => {
    render(<GisToolsPanel />);
    const selects = screen.getAllByRole('combobox');
    expect((selects[1] as HTMLSelectElement).value).toBe('UTM');
  });

  it('CRS select contains all supported options', () => {
    render(<GisToolsPanel />);
    // Both selects share the same options list; test first select
    ['WGS84', 'GCJ-02', 'UTM', 'ECEF', 'MGRS'].forEach((crs) => {
      expect(screen.getAllByRole('option', { name: crs }).length).toBeGreaterThan(0);
    });
  });

  it('default Latitude input is 39.9042', () => {
    render(<GisToolsPanel />);
    expect(screen.getByDisplayValue('39.9042')).toBeInTheDocument();
  });

  it('default Longitude input is 116.4074', () => {
    render(<GisToolsPanel />);
    expect(screen.getByDisplayValue('116.4074')).toBeInTheDocument();
  });

  it('input labels are Latitude / Longitude / Altitude for WGS84 source', () => {
    render(<GisToolsPanel />);
    expect(screen.getByText('Latitude')).toBeInTheDocument();
    expect(screen.getByText('Longitude')).toBeInTheDocument();
    expect(screen.getByText('Altitude')).toBeInTheDocument();
  });

  it('input labels change to Easting / Northing / Zone when source is UTM', () => {
    render(<GisToolsPanel />);
    const sourceSelect = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(sourceSelect, { target: { value: 'UTM' } });
    expect(screen.getByText('Easting')).toBeInTheDocument();
    expect(screen.getByText('Northing')).toBeInTheDocument();
    expect(screen.getByText('Zone')).toBeInTheDocument();
  });

  it('input labels change to X / Y / Z when source is ECEF', () => {
    render(<GisToolsPanel />);
    const sourceSelect = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(sourceSelect, { target: { value: 'ECEF' } });
    expect(screen.getByText('X (m)')).toBeInTheDocument();
    expect(screen.getByText('Y (m)')).toBeInTheDocument();
    expect(screen.getByText('Z (m)')).toBeInTheDocument();
  });

  it('renders Convert button', () => {
    render(<GisToolsPanel />);
    expect(screen.getByRole('button', { name: 'Convert' })).toBeInTheDocument();
  });

  it('shows error for invalid (NaN) coordinate input', async () => {
    render(<GisToolsPanel />);
    const latInput = screen.getByDisplayValue('39.9042');
    fireEvent.change(latInput, { target: { value: 'not-a-number' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText('Invalid coordinate input')).toBeInTheDocument();
    });
  });

  it('shows unsupported-conversion error for MGRS → UTM', async () => {
    render(<GisToolsPanel />);
    const [sourceSelect, targetSelect] = screen.getAllByRole('combobox');
    fireEvent.change(sourceSelect!, { target: { value: 'MGRS' } });
    fireEvent.change(targetSelect!, { target: { value: 'UTM' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText(/not supported/)).toBeInTheDocument();
    });
  });

  it('WGS84 → UTM conversion shows Easting, Northing, Zone, Altitude results', async () => {
    render(<GisToolsPanel />);
    // Default source=WGS84, target=UTM
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText('Easting')).toBeInTheDocument();
      expect(screen.getByText('Northing')).toBeInTheDocument();
      expect(screen.getByText('Zone')).toBeInTheDocument();
      expect(screen.getByText('50N')).toBeInTheDocument();
    });
  });

  it('WGS84 → GCJ-02 conversion shows Latitude, Longitude, Altitude results', async () => {
    render(<GisToolsPanel />);
    const targetSelect = screen.getAllByRole('combobox')[1]!;
    fireEvent.change(targetSelect, { target: { value: 'GCJ-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      // Check unique result values; 'Latitude'/'Longitude' also appear as input labels so avoid getByText
      expect(screen.getByText('39.90887766')).toBeInTheDocument();
      expect(screen.getByText('116.41354321')).toBeInTheDocument();
    });
  });

  it('WGS84 → ECEF conversion shows X, Y, Z results', async () => {
    render(<GisToolsPanel />);
    const targetSelect = screen.getAllByRole('combobox')[1]!;
    fireEvent.change(targetSelect, { target: { value: 'ECEF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText('X')).toBeInTheDocument();
      expect(screen.getByText('Y')).toBeInTheDocument();
      expect(screen.getByText('Z')).toBeInTheDocument();
    });
  });

  it('WGS84 → MGRS conversion shows MGRS result string', async () => {
    render(<GisToolsPanel />);
    const targetSelect = screen.getAllByRole('combobox')[1]!;
    fireEvent.change(targetSelect, { target: { value: 'MGRS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      // 'MGRS' also appears in <option> elements; only check unique value
      expect(screen.getByText('50SMG4825115584')).toBeInTheDocument();
    });
  });

  it('no results shown before first Convert click', () => {
    render(<GisToolsPanel />);
    // change target so we look for specific result labels
    const targetSelect = screen.getAllByRole('combobox')[1]!;
    fireEvent.change(targetSelect, { target: { value: 'ECEF' } });
    expect(screen.queryByText('X')).not.toBeInTheDocument();
  });

  it('previous results are cleared when a new conversion produces an error', async () => {
    render(<GisToolsPanel />);
    // First: valid WGS84 → UTM
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => expect(screen.getByText('Easting')).toBeInTheDocument());

    // Second: invalid input
    const latInput = screen.getByDisplayValue('39.9042');
    fireEvent.change(latInput, { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    await waitFor(() => {
      expect(screen.getByText('Invalid coordinate input')).toBeInTheDocument();
      expect(screen.queryByText('Easting')).not.toBeInTheDocument();
    });
  });
});
