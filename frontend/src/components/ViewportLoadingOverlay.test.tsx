import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ViewportLoadingOverlay } from './ViewportLoadingOverlay';
import { useLoadingProgressStore } from '../stores/loadingProgressStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'loading.readingFile': 'Reading file...',
        'loading.parsingMap': 'Parsing map data...',
        'loading.generatingMesh': 'Generating road mesh...',
        'loading.complete': 'Loading complete',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('ViewportLoadingOverlay', () => {
  beforeEach(() => {
    useLoadingProgressStore.getState().reset();
  });

  it('should not render when phase is idle', () => {
    const { container } = render(<ViewportLoadingOverlay />);
    expect(container.querySelector('.viewport-loading-overlay')).toBeNull();
  });

  it('should render when loading is in progress', () => {
    useLoadingProgressStore.getState().startLoading('test.xodr');
    useLoadingProgressStore.getState().updateProgress('parsing', 45);
    render(<ViewportLoadingOverlay />);
    expect(screen.getByText('test.xodr')).toBeDefined();
    expect(screen.getByText('Parsing map data...')).toBeDefined();
    expect(screen.getByText('45%')).toBeDefined();
  });

  it('should show reading phase label', () => {
    useLoadingProgressStore.getState().startLoading('map.xodr');
    useLoadingProgressStore.getState().updateProgress('reading', 10);
    render(<ViewportLoadingOverlay />);
    expect(screen.getByText('Reading file...')).toBeDefined();
  });

  it('should show generating-mesh phase label', () => {
    useLoadingProgressStore.getState().startLoading('big.xodr');
    useLoadingProgressStore.getState().updateProgress('generating-mesh', 80);
    render(<ViewportLoadingOverlay />);
    expect(screen.getByText('Generating road mesh...')).toBeDefined();
  });

  it('should add fade-out class when done', () => {
    useLoadingProgressStore.getState().startLoading('done.xodr');
    useLoadingProgressStore.getState().finishLoading();
    const { container } = render(<ViewportLoadingOverlay />);
    const overlay = container.querySelector('.viewport-loading-overlay');
    expect(overlay?.classList.contains('fade-out')).toBe(true);
  });
});
