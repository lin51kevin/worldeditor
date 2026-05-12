import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Vec3Editor } from './Vec3Editor';

describe('Vec3Editor', () => {
  it('should render three number inputs with labels', () => {
    render(<Vec3Editor value={[1, 2, 3]} onChange={vi.fn()} />);
    expect(screen.getByLabelText('X')).toBeDefined();
    expect(screen.getByLabelText('Y')).toBeDefined();
    expect(screen.getByLabelText('Z')).toBeDefined();
  });

  it('should display the correct values', () => {
    render(<Vec3Editor value={[1.5, 2.5, 3.5]} onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect((inputs[0] as HTMLInputElement).value).toBe('1.5');
    expect((inputs[1] as HTMLInputElement).value).toBe('2.5');
    expect((inputs[2] as HTMLInputElement).value).toBe('3.5');
  });

  it('should call onChange with updated x when x input changes', () => {
    const onChange = vi.fn();
    render(<Vec3Editor value={[0, 0, 0]} onChange={onChange} />);
    const xInput = screen.getByLabelText('X');
    fireEvent.change(xInput, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith([5, 0, 0]);
  });

  it('should call onChange with updated y when y input changes', () => {
    const onChange = vi.fn();
    render(<Vec3Editor value={[0, 0, 0]} onChange={onChange} />);
    const yInput = screen.getByLabelText('Y');
    fireEvent.change(yInput, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith([0, 3, 0]);
  });

  it('should call onChange with updated z when z input changes', () => {
    const onChange = vi.fn();
    render(<Vec3Editor value={[0, 0, 0]} onChange={onChange} />);
    const zInput = screen.getByLabelText('Z');
    fireEvent.change(zInput, { target: { value: '-1' } });
    expect(onChange).toHaveBeenCalledWith([0, 0, -1]);
  });

  it('should not call onChange for invalid (NaN) input', () => {
    const onChange = vi.fn();
    render(<Vec3Editor value={[0, 0, 0]} onChange={onChange} />);
    const xInput = screen.getByLabelText('X');
    fireEvent.change(xInput, { target: { value: 'abc' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should render with custom step', () => {
    render(<Vec3Editor value={[0, 0, 0]} onChange={vi.fn()} step={0.01} />);
    const inputs = screen.getAllByRole('spinbutton');
    expect((inputs[0] as HTMLInputElement).step).toBe('0.01');
  });

  it('should be disabled when disabled prop is true', () => {
    render(<Vec3Editor value={[0, 0, 0]} onChange={vi.fn()} disabled />);
    const inputs = screen.getAllByRole('spinbutton');
    inputs.forEach((input) => {
      expect((input as HTMLInputElement).disabled).toBe(true);
    });
  });
});
