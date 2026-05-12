import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ColorEditor } from './ColorEditor';

describe('ColorEditor', () => {
  it('should render a color input', () => {
    render(<ColorEditor value="#ff0000" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('should display the hex value in the text input', () => {
    render(<ColorEditor value="#ff0000" onChange={vi.fn()} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('#ff0000');
  });

  it('should call onChange when hex input changes to a valid color', () => {
    const onChange = vi.fn();
    render(<ColorEditor value="#ff0000" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '#00ff00' } });
    expect(onChange).toHaveBeenCalledWith('#00ff00');
  });

  it('should call onChange when color picker changes', () => {
    const onChange = vi.fn();
    render(<ColorEditor value="#ff0000" onChange={onChange} />);
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: '#0000ff' } });
    expect(onChange).toHaveBeenCalledWith('#0000ff');
  });

  it('should not call onChange for invalid hex color', () => {
    const onChange = vi.fn();
    render(<ColorEditor value="#ff0000" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'notacolor' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should be disabled when disabled prop is true', () => {
    render(<ColorEditor value="#ff0000" onChange={vi.fn()} disabled />);
    const textInput = screen.getByRole('textbox') as HTMLInputElement;
    expect(textInput.disabled).toBe(true);
  });

  it('should display color swatch with current value', () => {
    render(<ColorEditor value="#ff0000" onChange={vi.fn()} />);
    const colorInput = document.querySelector('input[type="color"]') as HTMLInputElement;
    expect(colorInput.value).toBe('#ff0000');
  });
});
