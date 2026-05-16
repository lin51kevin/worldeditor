import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useViewportStore } from '../../stores/viewportStore';
import { MeasurementPanel } from './MeasurementPanel';

describe('MeasurementPanel', () => {
  beforeEach(() => {
    useViewportStore.setState({
      measureMode: 'none',
      measurePoints: [],
      lastMeasurement: null,
    });
  });

  it('should not render when measureMode is none', () => {
    render(<MeasurementPanel />);
    expect(screen.queryByTestId('measurement-panel')).toBeNull();
  });

  it('should render when measureMode is distance', () => {
    useViewportStore.setState({ measureMode: 'distance' });
    render(<MeasurementPanel />);
    expect(screen.getByTestId('measurement-panel')).toBeTruthy();
  });

  it('should show three mode buttons', () => {
    useViewportStore.setState({ measureMode: 'distance' });
    render(<MeasurementPanel />);
    expect(screen.getByTestId('measure-mode-distance')).toBeTruthy();
    expect(screen.getByTestId('measure-mode-angle')).toBeTruthy();
    expect(screen.getByTestId('measure-mode-area')).toBeTruthy();
  });

  it('should switch mode when clicking a mode button', () => {
    useViewportStore.setState({ measureMode: 'distance' });
    render(<MeasurementPanel />);
    act(() => {
      fireEvent.click(screen.getByTestId('measure-mode-angle'));
    });
    expect(useViewportStore.getState().measureMode).toBe('angle');
  });

  it('should close panel when clicking close button', () => {
    useViewportStore.setState({ measureMode: 'distance' });
    const { rerender } = render(<MeasurementPanel />);
    expect(screen.getByTestId('measurement-panel')).toBeTruthy();
    act(() => {
      const closeBtn = screen.getByTestId('measurement-panel').querySelector('.measurement-close');
      if (closeBtn) fireEvent.click(closeBtn);
    });
    rerender(<MeasurementPanel />);
    expect(screen.queryByTestId('measurement-panel')).toBeNull();
  });

  it('should show distance measurement result', () => {
    useViewportStore.setState({
      measureMode: 'distance',
      measurePoints: [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 4, z: 5 },
      ],
      lastMeasurement: {
        type: 'distance',
        value: { straight: 7.071, horizontal: 5.0, vertical: 5.0 },
      },
    });
    render(<MeasurementPanel />);
    expect(screen.getByText('7.071 m')).toBeTruthy();
    // horizontal and vertical are both 5.000 m
    expect(screen.getAllByText('5.000 m')).toHaveLength(2);
  });

  it('should show angle measurement result', () => {
    useViewportStore.setState({
      measureMode: 'angle',
      measurePoints: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
      ],
      lastMeasurement: {
        type: 'angle',
        value: { radians: 1.5708, degrees: 90.0 },
      },
    });
    render(<MeasurementPanel />);
    expect(screen.getByText('90.00°')).toBeTruthy();
  });

  it('should show area measurement result', () => {
    useViewportStore.setState({
      measureMode: 'area',
      measurePoints: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 10, z: 0 },
      ],
      lastMeasurement: {
        type: 'area',
        value: { area: 50.0, perimeter: 34.142 },
      },
    });
    render(<MeasurementPanel />);
    expect(screen.getByText('50.000 m²')).toBeTruthy();
  });

  it('should clear points when clicking clear button', () => {
    useViewportStore.setState({
      measureMode: 'distance',
      measurePoints: [{ x: 0, y: 0, z: 0 }],
      lastMeasurement: {
        type: 'distance',
        value: { straight: 10, horizontal: 10, vertical: 0 },
      },
    });
    render(<MeasurementPanel />);
    act(() => {
      const clearBtn = screen.getByRole('button', { name: /measurement\.clear|清除|Clear/i });
      fireEvent.click(clearBtn);
    });
    expect(useViewportStore.getState().measurePoints).toEqual([]);
    expect(useViewportStore.getState().lastMeasurement).toBeNull();
  });
});
