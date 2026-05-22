import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { TabbedFloatingPanel, type TabConfig } from './TabbedFloatingPanel';

vi.mock('./FloatingPanel', () => ({
  FloatingPanel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="floating-panel" className={className}>
      {children}
    </div>
  ),
}));

function PropertyPanel() {
  return <div>Property content</div>;
}

function AlphaPanel() {
  return <div>Alpha content</div>;
}

function BetaPanel() {
  return <div>Beta content</div>;
}

function HiddenPanel() {
  return <div>Hidden content</div>;
}

function renderHarness(options?: { activeTabId?: string | null; tabs?: TabConfig[] }) {
  const onTabChange = vi.fn();
  const onTabClose = vi.fn();
  const onClose = vi.fn();
  const onActivate = vi.fn();

  const tabs: TabConfig[] = options?.tabs ?? [
    { id: 'alpha', title: 'Alpha', component: AlphaPanel, visible: true },
    { id: 'core:property', title: 'Property', component: PropertyPanel, visible: true, closable: false },
    { id: 'beta', title: 'Beta', component: BetaPanel, visible: true, onActivate },
    { id: 'hidden', title: 'Hidden', component: HiddenPanel, visible: false },
  ];

  function Harness() {
    const [activeTabId, setActiveTabId] = useState<string | null>(options?.activeTabId ?? 'alpha');

    return (
      <TabbedFloatingPanel
        storageKey="tabbed-panel-test"
        defaultWidth={320}
        activeTabId={activeTabId}
        tabs={tabs}
        onTabChange={(tabId) => {
          onTabChange(tabId);
          setActiveTabId(tabId);
        }}
        onTabClose={onTabClose}
        onClose={onClose}
      />
    );
  }

  return { ...render(<Harness />), onActivate, onClose, onTabChange, onTabClose };
}

describe('TabbedFloatingPanel', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders visible tabs with the property tab fixed first', () => {
    const { container } = renderHarness();

    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('.tp-tab-title')).map((node) => node.textContent)).toEqual([
      'Property',
      'Alpha',
      'Beta',
    ]);
    expect(screen.queryByLabelText('关闭 Property')).not.toBeInTheDocument();
  });

  it('switches tabs, updates visible content, and runs activation callbacks', () => {
    const { onActivate, onTabChange } = renderHarness();

    expect(screen.getByText('Alpha content').parentElement).not.toHaveStyle({ display: 'none' });
    expect(screen.getByText('Beta content').parentElement).toHaveStyle({ display: 'none' });

    fireEvent.click(screen.getByText('Beta'));

    expect(onTabChange).toHaveBeenCalledWith('beta');
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Beta content').parentElement).not.toHaveStyle({ display: 'none' });
    expect(screen.getByText('Alpha content').parentElement).toHaveStyle({ display: 'none' });
  });

  it('falls back to the first visible tab when the active tab is invalid', () => {
    const { onTabChange } = renderHarness({ activeTabId: 'missing' });

    expect(onTabChange).toHaveBeenCalledWith('core:property');
    expect(screen.getByText('Property content').parentElement).not.toHaveStyle({ display: 'none' });
  });

  it('calls tab close and panel close handlers', () => {
    const { onClose, onTabClose } = renderHarness();

    fireEvent.click(screen.getByLabelText('关闭 Beta'));
    fireEvent.click(screen.getByLabelText('关闭面板'));

    expect(onTabClose).toHaveBeenCalledWith('beta');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns null when there are no visible tabs', () => {
    const { container } = renderHarness({
      tabs: [{ id: 'hidden-only', title: 'Hidden', component: HiddenPanel, visible: false }],
      activeTabId: null,
    });

    expect(container).toBeEmptyDOMElement();
  });
});
