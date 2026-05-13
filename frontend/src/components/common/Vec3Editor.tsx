/** Three-component vector editor (X, Y, Z number inputs). */
export interface Vec3EditorProps {
  value: [number, number, number];
  onChange: (value: [number, number, number]) => void;
  step?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Renders three labelled numeric inputs for editing a 3D vector.
 */
export function Vec3Editor({
  value,
  onChange,
  step = 0.1,
  disabled = false,
  className,
}: Vec3EditorProps) {
  const handleChange = (axis: 0 | 1 | 2, raw: string) => {
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    const next: [number, number, number] = [value[0], value[1], value[2]];
    next[axis] = parsed;
    onChange(next);
  };

  const axes = ['X', 'Y', 'Z'] as const;

  return (
    <div className={`vec3-editor${className ? ` ${className}` : ''}`}>
      {axes.map((label, idx) => (
        <label key={label} className="vec3-editor-field">
          <span className="vec3-editor-label">{label}</span>
          <input
            id={label}
            aria-label={label}
            type="number"
            step={step}
            value={value[idx]}
            disabled={disabled}
            onChange={(e) => handleChange(idx as 0 | 1 | 2, e.target.value)}
            className="vec3-editor-input"
          />
        </label>
      ))}
    </div>
  );
}
