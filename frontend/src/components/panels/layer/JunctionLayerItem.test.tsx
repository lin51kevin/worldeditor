import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Junction } from '../../../services/platform';
import { JunctionLayerItem } from './JunctionLayerItem';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'layerPanel.zoomTo': 'Zoom to',
      'layerPanel.hideRoad': 'Hide road',
      'layerPanel.showRoad': 'Show road',
    }[key] ?? key),
  }),
}));

const junction: Junction = {
  id: 'j-1',
  name: 'Central Junction',
  connections: [],
};

describe('JunctionLayerItem', () => {
  it('renders the junction name, id, and icon', () => {
    const { container } = render(
      <JunctionLayerItem
        junction={junction}
        isSelected={false}
        isVisible={true}
        onSelect={vi.fn()}
        onZoom={vi.fn()}
        onToggleVisibility={vi.fn()}
      />,
    );

    expect(screen.getByText('Central Junction')).toBeInTheDocument();
    expect(screen.getByText('(j-1)')).toBeInTheDocument();
    expect(container.querySelector('.junction-icon')).toBeInTheDocument();
  });

  it('selects the junction on click and keeps zoom and visibility actions separate', () => {
    const onSelect = vi.fn();
    const onZoom = vi.fn();
    const onToggleVisibility = vi.fn();

    render(
      <JunctionLayerItem
        junction={junction}
        isSelected={true}
        isVisible={true}
        onSelect={onSelect}
        onZoom={onZoom}
        onToggleVisibility={onToggleVisibility}
      />,
    );

    fireEvent.click(screen.getByText('Central Junction'));
    fireEvent.click(screen.getByTitle('Zoom to'));
    fireEvent.click(screen.getByTitle('Hide road'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onToggleVisibility).toHaveBeenCalledTimes(1);
  });
});
