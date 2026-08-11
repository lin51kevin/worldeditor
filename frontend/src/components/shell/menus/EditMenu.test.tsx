import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../../../stores/projectStore';
import { showConfirm } from '../../../utils/dialog';
import { EditMenu } from './EditMenu';

vi.mock('../../../utils/dialog', () => ({
  showConfirm: vi.fn(),
}));

vi.mock('./MenuSection', () => ({
  MenuSection: ({ menu }: { menu: { label: string; items: Array<{ label: string; action?: () => void; disabled?: boolean; separator?: boolean }> } }) => (
    <div>
      <h1>{menu.label}</h1>
      {menu.items.map((item, index) =>
        item.separator ? (
          <div key={index} data-testid="separator" />
        ) : (
          <button key={index} type="button" disabled={item.disabled} onClick={() => void item.action?.()}>
            {item.label}
          </button>
        ),
      )}
    </div>
  ),
}));

const t = (key: string) => ({
  'menu.edit': 'Edit',
  'menu.undo': 'Undo',
  'menu.redo': 'Redo',
  'menu.deleteSelected': 'Delete Selected',
  'menu.selectAll': 'Select All',
  'menu.copy': 'Copy',
  'menu.paste': 'Paste',
  'menu.pluginCut': 'Plugin Cut',
  'menu.pluginCopy': 'Plugin Copy',
  'menu.pluginPaste': 'Plugin Paste',
  'dialog.confirmDelete': 'Confirm delete?',
}[key] ?? key);

const interactionProps = {
  isActive: true,
  hoveredSubItem: null,
  onHover: vi.fn(),
  onToggle: vi.fn(),
  onSubItemHover: vi.fn(),
  onClose: vi.fn(),
};

describe('EditMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(showConfirm).mockResolvedValue(true);
  });

  it('renders undo, redo, delete, select-all/copy/paste, and appended plugin cut/copy/paste menu items', () => {
    render(
      <EditMenu
        {...interactionProps}
        t={t}
        editMenuItems={[
          { id: 'cut', pluginId: 'plugin', menu: 'edit', labelKey: 'menu.pluginCut', onClick: vi.fn() },
          { id: 'copy', pluginId: 'plugin', menu: 'edit', labelKey: 'menu.pluginCopy', onClick: vi.fn() },
          { id: 'paste', pluginId: 'plugin', menu: 'edit', labelKey: 'menu.pluginPaste', onClick: vi.fn() },
        ]}
        canUndo={true}
        canRedo={true}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Select All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plugin Cut' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plugin Copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plugin Paste' })).toBeInTheDocument();
  });

  it('triggers select all / copy / paste on the project store', () => {
    const selectAll = vi.spyOn(useProjectStore.getState(), 'selectAll').mockImplementation(() => {});
    const copySelected = vi.spyOn(useProjectStore.getState(), 'copySelected').mockImplementation(() => {});
    const pasteFromClipboard = vi.spyOn(useProjectStore.getState(), 'pasteFromClipboard').mockImplementation(() => {});

    render(
      <EditMenu
        {...interactionProps}
        t={t}
        editMenuItems={[]}
        canUndo={true}
        canRedo={true}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(copySelected).toHaveBeenCalledTimes(1);
    expect(pasteFromClipboard).toHaveBeenCalledTimes(1);

    selectAll.mockRestore();
    copySelected.mockRestore();
    pasteFromClipboard.mockRestore();
  });

  it('triggers edit actions and respects disabled undo/redo state', async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onDelete = vi.fn();
    const onCut = vi.fn();
    const onCopy = vi.fn();
    const onPaste = vi.fn();

    const { rerender } = render(
      <EditMenu
        {...interactionProps}
        t={t}
        editMenuItems={[
          { id: 'cut', pluginId: 'plugin', menu: 'edit', labelKey: 'menu.pluginCut', onClick: onCut },
          { id: 'copy', pluginId: 'plugin', menu: 'edit', labelKey: 'menu.pluginCopy', onClick: onCopy },
          { id: 'paste', pluginId: 'plugin', menu: 'edit', labelKey: 'menu.pluginPaste', onClick: onPaste },
        ]}
        canUndo={true}
        canRedo={true}
        onUndo={onUndo}
        onRedo={onRedo}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plugin Cut' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plugin Copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Plugin Paste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onCut).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onPaste).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(showConfirm).toHaveBeenCalledWith('Confirm delete?');

    rerender(
      <EditMenu
        {...interactionProps}
        t={t}
        editMenuItems={[]}
        canUndo={false}
        canRedo={false}
        onUndo={onUndo}
        onRedo={onRedo}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});
