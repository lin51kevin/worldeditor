import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ValidationPanel } from './ValidationPanel';

vi.mock('../../stores/editorStore', () => ({
  useEditorStore: (selector: (s: any) => any) =>
    selector({
      project: {
        name: 'test',
        header: { name: 'test', revMajor: 1, revMinor: 0, date: '', north: 0, south: 0, east: 0, west: 0, vendor: '' },
        roads: [],
        junctions: [],
        signals: [],
        objects: [],
      },
    }),
}));

describe('ValidationPanel', () => {
  it('renders validate button and placeholder text', () => {
    render(<ValidationPanel />);
    expect(screen.getByText('Validate')).toBeDefined();
    expect(screen.getByText(/项目验证通过/)).toBeDefined();
  });

  it('shows issues after clicking validate on empty project', async () => {
    render(<ValidationPanel />);
    screen.getByText('Validate').click();
    // Empty project should produce "Project has no roads" info
    const infoText = await screen.findByText('Project has no roads');
    expect(infoText).toBeDefined();
  });
});
