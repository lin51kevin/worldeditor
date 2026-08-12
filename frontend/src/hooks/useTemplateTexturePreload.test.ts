import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useTemplateTexturePreload } from './useTemplateTexturePreload';
import { usePluginContribStore } from '../stores/pluginContribStore';
import type { ViewportRenderer } from '../viewport/renderer';

function mockRenderer(preload: (urls: string[]) => Promise<void>) {
  return { getTextureManager: () => ({ preload }) } as unknown as ViewportRenderer;
}

describe('useTemplateTexturePreload', () => {
  afterEach(() => {
    usePluginContribStore.setState({ templateSections: [] });
    vi.restoreAllMocks();
  });

  it('preloads distinct thumbnail URLs from all template sections once ready', () => {
    usePluginContribStore.setState({
      templateSections: [
        {
          id: 'signals', pluginId: 'p', categoryKey: 'k', order: 0,
          items: [
            { id: 'a', labelKey: 'a', icon: '', thumbnailUrl: '/assets/textures/RoadSigns/1010100111001111.png', onApply: () => {} },
            { id: 'b', labelKey: 'b', icon: '', thumbnailUrl: undefined, onApply: () => {} },
          ],
        },
        {
          id: 'objects', pluginId: 'p', categoryKey: 'k', order: 1,
          items: [
            { id: 'c', labelKey: 'c', icon: '', thumbnailUrl: '/assets/textures/RoadSigns/1010100111001111.png', onApply: () => {} },
          ],
        },
      ],
    });
    const preload = vi.fn().mockResolvedValue(undefined);
    const rendererRef = createRef<ViewportRenderer | null>();
    rendererRef.current = mockRenderer(preload);

    renderHook(() => useTemplateTexturePreload({ rendererRef, status: 'ready' }));

    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload.mock.calls[0][0]).toEqual(['/assets/textures/RoadSigns/1010100111001111.png']);
  });

  it('does nothing while the renderer is not ready', () => {
    usePluginContribStore.setState({
      templateSections: [{
        id: 'signals', pluginId: 'p', categoryKey: 'k', order: 0,
        items: [{ id: 'a', labelKey: 'a', icon: '', thumbnailUrl: '/x.png', onApply: () => {} }],
      }],
    });
    const preload = vi.fn().mockResolvedValue(undefined);
    const rendererRef = createRef<ViewportRenderer | null>();
    rendererRef.current = mockRenderer(preload);

    renderHook(() => useTemplateTexturePreload({ rendererRef, status: 'loading' }));

    expect(preload).not.toHaveBeenCalled();
  });
});
