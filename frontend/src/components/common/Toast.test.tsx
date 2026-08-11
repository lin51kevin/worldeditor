import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { useToastStore } from '../../stores/toastStore';
import { ToastHost } from './Toast';

describe('ToastHost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clearToasts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastHost />);
    expect(container.querySelector('.toast-item')).toBeNull();
  });

  it('renders a toast message when pushed', () => {
    render(<ToastHost />);
    act(() => {
      useToastStore.getState().pushToast({ message: 'Saved', variant: 'success', duration: 4000 });
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    render(<ToastHost />);
    act(() => {
      useToastStore.getState().pushToast({ message: 'first', variant: 'info', duration: 4000 });
      useToastStore.getState().pushToast({ message: 'second', variant: 'error', duration: 4000 });
    });
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();
  });

  it('auto-dismisses a toast after its duration elapses', () => {
    render(<ToastHost />);
    act(() => {
      useToastStore.getState().pushToast({ message: 'Saved', variant: 'success', duration: 1000 });
    });
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('dismisses a toast when the close button is clicked', () => {
    render(<ToastHost />);
    act(() => {
      useToastStore.getState().pushToast({ message: 'Saved', variant: 'success', duration: 10000 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('does not auto-dismiss when duration is 0', () => {
    render(<ToastHost />);
    act(() => {
      useToastStore.getState().pushToast({ message: 'Sticky', variant: 'info', duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText('Sticky')).toBeInTheDocument();
  });
});
