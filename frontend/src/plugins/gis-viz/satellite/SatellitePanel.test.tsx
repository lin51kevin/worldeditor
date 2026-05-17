import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SatellitePanel from './SatellitePanel';
import { useSatelliteOverlayStore } from './satelliteState';

beforeEach(() => {
  useSatelliteOverlayStore.setState({ enabled: false, opacity: 0.55, style: 'hybrid' });
});

describe('SatellitePanel', () => {
  it('renders "Viewport Basemap" title', () => {
    render(<SatellitePanel />);
    expect(screen.getByText('Viewport Basemap')).toBeInTheDocument();
  });

  it('renders "Enable basemap overlay" checkbox label', () => {
    render(<SatellitePanel />);
    expect(screen.getByText('Enable basemap overlay')).toBeInTheDocument();
  });

  it('checkbox is unchecked by default (enabled = false)', () => {
    render(<SatellitePanel />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('checking the checkbox sets enabled to true in the store', () => {
    render(<SatellitePanel />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(useSatelliteOverlayStore.getState().enabled).toBe(true);
  });

  it('unchecking the checkbox sets enabled to false in the store', () => {
    useSatelliteOverlayStore.setState({ enabled: true });
    render(<SatellitePanel />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(useSatelliteOverlayStore.getState().enabled).toBe(false);
  });

  it('style select has Hybrid, Survey and Mono options', () => {
    render(<SatellitePanel />);
    expect(screen.getByRole('option', { name: 'Hybrid' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Survey' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mono' })).toBeInTheDocument();
  });

  it('default selected style is Hybrid', () => {
    render(<SatellitePanel />);
    expect(screen.getByDisplayValue('Hybrid')).toBeInTheDocument();
  });

  it('changing style to Survey updates the store', () => {
    render(<SatellitePanel />);
    fireEvent.change(screen.getByDisplayValue('Hybrid'), { target: { value: 'survey' } });
    expect(useSatelliteOverlayStore.getState().style).toBe('survey');
  });

  it('changing style to Mono updates the store', () => {
    render(<SatellitePanel />);
    fireEvent.change(screen.getByDisplayValue('Hybrid'), { target: { value: 'mono' } });
    expect(useSatelliteOverlayStore.getState().style).toBe('mono');
  });

  it('renders opacity range slider', () => {
    render(<SatellitePanel />);
    const slider = screen.getByRole('slider');
    expect(slider).toBeInTheDocument();
  });

  it('opacity slider has correct min/max/step attributes', () => {
    render(<SatellitePanel />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    expect(slider.min).toBe('0.1');
    expect(slider.max).toBe('0.9');
    expect(slider.step).toBe('0.05');
  });

  it('changing opacity slider updates the store', () => {
    render(<SatellitePanel />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.7' } });
    expect(useSatelliteOverlayStore.getState().opacity).toBeCloseTo(0.7);
  });

  it('preview swatch has hybrid class by default', () => {
    render(<SatellitePanel />);
    const swatch = document.querySelector('.satellite-panel__swatch');
    expect(swatch).toHaveClass('satellite-panel__swatch--hybrid');
  });

  it('preview swatch has survey class when style is survey', () => {
    useSatelliteOverlayStore.setState({ style: 'survey' });
    render(<SatellitePanel />);
    const swatch = document.querySelector('.satellite-panel__swatch');
    expect(swatch).toHaveClass('satellite-panel__swatch--survey');
  });

  it('preview swatch has mono class when style is mono', () => {
    useSatelliteOverlayStore.setState({ style: 'mono' });
    render(<SatellitePanel />);
    const swatch = document.querySelector('.satellite-panel__swatch');
    expect(swatch).toHaveClass('satellite-panel__swatch--mono');
  });

  it('preview caption text is rendered', () => {
    render(<SatellitePanel />);
    expect(screen.getByText(/Applies as a lightweight overlay/)).toBeInTheDocument();
  });
});
