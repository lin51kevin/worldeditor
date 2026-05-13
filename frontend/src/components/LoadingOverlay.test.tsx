import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingOverlay } from './LoadingOverlay';
import { useLoadingStore } from '../stores/loadingStore';

describe('LoadingOverlay', () => {
  beforeEach(() => {
    useLoadingStore.setState({ isLoading: false, message: '', _count: 0 });
  });

  it('renders nothing when isLoading is false', () => {
    const { container } = render(<LoadingOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('renders overlay with message when isLoading is true', () => {
    useLoadingStore.getState().showLoading('Saving...');
    const { container, unmount } = render(<LoadingOverlay />);
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
    expect(container.querySelector('.loading-spinner')).not.toBeNull();
    expect(container.querySelector('.loading-message')?.textContent).toBe('Saving...');
    unmount();
  });

  it('has role="alert" for accessibility', () => {
    useLoadingStore.getState().showLoading('Loading...');
    const { container, unmount } = render(<LoadingOverlay />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    unmount();
  });
});
