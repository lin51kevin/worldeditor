import { useState } from 'react';

/** Valid CSS hex color string — e.g. "#ff0000". */
type HexColor = string;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidHex(v: string): boolean {
  return HEX_RE.test(v);
}

export interface ColorEditorProps {
  value: HexColor;
  onChange: (value: HexColor) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Color picker with native color swatch and hex text input.
 *
 * Changes are only emitted for valid 6-digit hex colors.
 */
export function ColorEditor({ value, onChange, disabled = false, className }: ColorEditorProps) {
  const [draft, setDraft] = useState(value);

  // Keep draft in sync when value changes externally
  if (draft !== value && isValidHex(value)) {
    setDraft(value);
  }

  const handleTextChange = (raw: string) => {
    setDraft(raw);
    if (isValidHex(raw)) {
      onChange(raw);
    }
  };

  const handleColorPickerChange = (raw: string) => {
    setDraft(raw);
    onChange(raw);
  };

  return (
    <div className={`color-editor${className ? ` ${className}` : ''}`}>
      <input
        type="color"
        value={isValidHex(draft) ? draft : value}
        disabled={disabled}
        onChange={(e) => handleColorPickerChange(e.target.value)}
        className="color-editor-swatch"
        aria-label="color-picker"
      />
      <input
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => handleTextChange(e.target.value)}
        className="color-editor-input"
        maxLength={7}
        spellCheck={false}
      />
    </div>
  );
}
