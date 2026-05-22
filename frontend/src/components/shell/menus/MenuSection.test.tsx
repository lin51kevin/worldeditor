import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Menu } from '../menuDefinitions';
import { MenuSection } from './MenuSection';

function renderMenuSection(menu: Menu) {
  const onHover = vi.fn();
  const onToggle = vi.fn();
  const onClose = vi.fn();

  function Harness() {
    const [hoveredSubItem, setHoveredSubItem] = useState<number | null>(null);

    return (
      <MenuSection
        menu={menu}
        isActive={true}
        hoveredSubItem={hoveredSubItem}
        onHover={onHover}
        onToggle={onToggle}
        onSubItemHover={setHoveredSubItem}
        onClose={onClose}
      />
    );
  }

  return { ...render(<Harness />), onClose, onHover, onToggle };
}

describe('MenuSection', () => {
  it('renders the section title, children, and separators', () => {
    const primaryAction = vi.fn();
    const menu: Menu = {
      label: 'View',
      items: [
        { label: 'Show Grid', action: primaryAction, shortcut: 'G', checked: true },
        { separator: true, label: '' },
        { label: 'Reset Panels', action: vi.fn() },
      ],
    };
    const { container, onHover, onToggle, onClose } = renderMenuSection(menu);

    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show Grid/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset Panels' })).toBeInTheDocument();
    expect(container.querySelector('.menubar-separator')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText('View'));
    fireEvent.click(screen.getByText('View'));
    fireEvent.click(screen.getByRole('button', { name: /Show Grid/ }));

    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(primaryAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders submenu items and closes after submenu actions', () => {
    const subAction = vi.fn();
    const menu: Menu = {
      label: 'Tools',
      items: [
        {
          label: 'Measurements',
          submenu: [
            { label: 'Distance', action: subAction },
            { separator: true, label: '' },
            { label: 'Disabled Tool', disabled: true, action: vi.fn() },
          ],
        },
      ],
    };
    const { container, onClose } = renderMenuSection(menu);

    fireEvent.mouseEnter(screen.getByText('Measurements'));

    expect(screen.getByRole('button', { name: 'Distance' })).toBeInTheDocument();
    expect(container.querySelectorAll('.menubar-separator')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Disabled Tool' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Distance' }));

    expect(subAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
