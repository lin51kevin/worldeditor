import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShortcutHelpOverlay } from './ShortcutHelpOverlay';

describe('ShortcutHelpOverlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when open is false', () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutHelpOverlay open={false} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog when open is true', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('键盘快捷键')).toBeInTheDocument();
  });

  it('shows shortcut sections with translated labels', () => {
    render(<ShortcutHelpOverlay open={true} onClose={vi.fn()} />);
    expect(screen.getByText('绘图模式')).toBeInTheDocument();
    expect(screen.getByText('变换工具')).toBeInTheDocument();
    expect(screen.getByText('编辑操作')).toBeInTheDocument();
    expect(screen.getByText('面板')).toBeInTheDocument();
  });

  it('shows key bindings', () => {
    render(<ShortcutHelpOverlay open={true} onClose={vi.fn()} />);
    const allKbd = Array.from(document.querySelectorAll('kbd')).map((el) => el.textContent);
    expect(allKbd).toContain('/');
    expect(allKbd).toContain('?');
    expect(allKbd).toContain('E');
    expect(allKbd).toContain('M');
    expect(allKbd).toContain('V');
    expect(allKbd).toContain('Esc');
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when dialog card is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    const dialogCard = container.querySelector('.shortcut-help-dialog') as HTMLElement;
    fireEvent.click(dialogCard);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when close button (×) is clicked', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    // Close button aria-label is zh key 'dialog.close' = '关闭'
    const closeBtn = screen.getByLabelText('关闭');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when OK button is clicked', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    // In zh locale, dialog.ok = '确定'
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not add keydown listener when closed', () => {
    const onClose = vi.fn();
    render(<ShortcutHelpOverlay open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
