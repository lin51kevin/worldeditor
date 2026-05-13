import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditorViewStore } from '../../stores/editorViewStore';
import { OutputPanel } from './OutputPanel';

describe('OutputPanel', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollTo
    Element.prototype.scrollTo = vi.fn();

    act(() => {
      useEditorViewStore.setState({ layout: { leftWidth: 260, rightWidth: 300, outputHeight: 150, leftCollapsed: false, rightCollapsed: false, outputCollapsed: false, templatePanelCollapsed: false } });
    });
    vi.clearAllMocks();
  });

  it('renders with empty state', () => {
    render(<OutputPanel />);
    expect(screen.getByText('No output')).toBeInTheDocument();
    expect(screen.getByText('Output')).toBeInTheDocument();
  });

  it('renders log entries from custom events', () => {
    render(<OutputPanel />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent('we-log', { detail: { level: 'info', message: 'hello log' } }),
      );
    });
    expect(screen.getByText('hello log')).toBeInTheDocument();
  });

  it('renders multiple log levels', () => {
    render(<OutputPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent('we-log', { detail: { level: 'warn', message: 'warning msg' } }));
      window.dispatchEvent(new CustomEvent('we-log', { detail: { level: 'error', message: 'error msg' } }));
    });
    expect(screen.getByText('warning msg')).toBeInTheDocument();
    expect(screen.getByText('error msg')).toBeInTheDocument();
  });

  it('clear button removes all logs', () => {
    render(<OutputPanel />);
    act(() => {
      window.dispatchEvent(new CustomEvent('we-log', { detail: { level: 'info', message: 'to-clear' } }));
    });
    expect(screen.getByText('to-clear')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Clear'));
    expect(screen.queryByText('to-clear')).not.toBeInTheDocument();
    expect(screen.getByText('No output')).toBeInTheDocument();
  });

  it('close button calls toggleOutputPanel', () => {
    const spy = vi.spyOn(useEditorViewStore.getState(), 'toggleOutputPanel');
    render(<OutputPanel />);
    fireEvent.click(screen.getByTitle('Close'));
    expect(spy).toHaveBeenCalled();
  });
});
