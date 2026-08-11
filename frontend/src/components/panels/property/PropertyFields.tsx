import { memo, useEffect, useState, type ReactNode } from 'react';

/** Clamp helper shared by the transform editors. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Widest lateral offset worth exposing on a slider for a given road, so the
 * handle range always covers the carriageway plus a shoulder.
 */
export function roadLateralRange(laneSections: {
  left: { width: { a: number }[] }[];
  right: { width: { a: number }[] }[];
}[]): number {
  let maxWidth = 8;
  for (const section of laneSections) {
    const leftWidth = section.left.reduce((sum, lane) => sum + (lane.width[0]?.a ?? 3.5), 0);
    const rightWidth = section.right.reduce((sum, lane) => sum + (lane.width[0]?.a ?? 3.5), 0);
    maxWidth = Math.max(maxWidth, leftWidth, rightWidth);
  }
  return Math.max(8, Math.ceil(maxWidth + 4));
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

/** Range slider paired with a numeric box, both writing the same value. */
export const SliderField = memo(function SliderField({
  label,
  value,
  min,
  max,
  step = 0.1,
  unit = 'm',
  onChange,
}: SliderFieldProps) {
  const bounded = clamp(value, min, max);
  return (
    <div className="property-row property-row--stacked">
      <span className="property-label">{label}</span>
      <div className="property-control-stack">
        <input
          type="range"
          className="property-range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={bounded}
          onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        />
        <input
          className="property-input property-input-narrow"
          type="number"
          aria-label={`${label} (${unit})`}
          step={step}
          value={Number(value.toFixed(3))}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isNaN(next)) onChange(clamp(next, min, max));
          }}
        />
        <span className="property-unit">{unit}</span>
      </div>
    </div>
  );
});

interface NumberFieldProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  unit?: string;
  disabled?: boolean;
  title?: string;
  onChange: (value: number) => void;
}

/** Plain numeric box for values without a meaningful slider range. */
export const NumberField = memo(function NumberField({
  label,
  value,
  step = 0.1,
  min,
  unit = 'm',
  disabled = false,
  title,
  onChange,
}: NumberFieldProps) {
  return (
    <div className="property-row">
      <span className="property-label">{label}</span>
      <div className="property-value-group">
        <input
          className="property-input property-input-narrow"
          type="number"
          aria-label={label}
          title={title}
          step={step}
          min={min}
          disabled={disabled}
          value={Number(value.toFixed(3))}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isNaN(next)) onChange(min === undefined ? next : Math.max(min, next));
          }}
        />
        <span className="property-unit">{unit}</span>
      </div>
    </div>
  );
});

interface TextFieldProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}

/** Text box that commits on blur or Enter, so typing stays one undo step. */
export const TextField = memo(function TextField({ label, value, onCommit }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="property-row">
      <span className="property-label">{label}</span>
      <input
        className="property-input"
        aria-label={label}
        value={draft}
        placeholder="—"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
});

/** Read-only label/value pair. */
export const ReadOnlyField = memo(function ReadOnlyField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="property-row">
      <span className="property-label">{label}</span>
      <span className="property-value">{children}</span>
    </div>
  );
});
