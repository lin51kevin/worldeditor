import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveIcon } from './IconRenderer';

describe('resolveIcon', () => {
  it('resolves known icon names to Lucide SVG elements', () => {
    const { container } = render(<>{resolveIcon('Scissors', 20, 'tool-icon')}</>);

    const svg = container.querySelector('svg.tool-icon');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
  });

  it('renders unknown icon names as text and passes through existing nodes', () => {
    const custom = <span data-testid="custom-icon">Custom</span>;
    const { rerender } = render(<>{resolveIcon('UnknownIcon', 16, 'fallback-icon')}</>);

    expect(screen.getByText('UnknownIcon')).toHaveClass('fallback-icon');

    rerender(<>{resolveIcon(custom)}</>);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});
