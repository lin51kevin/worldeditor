import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SoftSelectionPanel, defaultSoftSelectionSettings } from './SoftSelectionPanel';

describe('SoftSelectionPanel', () => {
  it('renders with default settings', () => {
    render(<SoftSelectionPanel settings={defaultSoftSelectionSettings()} onChange={vi.fn()} />);
    expect(screen.getByTestId('soft-selection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('soft-sel-enabled')).not.toBeChecked();
  });

  it('shows controls when enabled', () => {
    render(<SoftSelectionPanel settings={{ ...defaultSoftSelectionSettings(), enabled: true }} onChange={vi.fn()} />);
    expect(screen.getByTestId('soft-sel-radius')).toBeInTheDocument();
    expect(screen.getByTestId('soft-sel-strength')).toBeInTheDocument();
    expect(screen.getByTestId('soft-sel-falloff')).toBeInTheDocument();
  });

  it('hides controls when disabled', () => {
    render(<SoftSelectionPanel settings={defaultSoftSelectionSettings()} onChange={vi.fn()} />);
    expect(screen.queryByTestId('soft-sel-radius')).not.toBeInTheDocument();
  });

  it('calls onChange when toggling enabled', () => {
    const onChange = vi.fn();
    render(<SoftSelectionPanel settings={defaultSoftSelectionSettings()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('soft-sel-enabled'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('defaultSoftSelectionSettings returns valid defaults', () => {
    const s = defaultSoftSelectionSettings();
    expect(s.enabled).toBe(false);
    expect(s.radius).toBe(20);
    expect(s.strength).toBe(0.5);
    expect(s.falloff).toBe('smooth');
  });
});
