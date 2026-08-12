import { useEffect, type RefObject } from 'react';
import type { ViewportRenderer } from '../viewport/renderer';
import { usePluginContribStore } from '../stores/pluginContribStore';

type ViewportStatus = 'loading' | 'ready' | 'unsupported';

/**
 * Preloads every registered template's thumbnail texture into the renderer's
 * GPU texture cache once it becomes ready.
 *
 * Without this, `TextureManager` only preloads the small set of textures
 * explicitly listed in manifest.json (traffic lights, paints, ~9 road signs).
 * Road-sign templates (100+ GB 5768 codes) resolve to on-the-fly generated
 * paths that are never preloaded, so the first time one is placed it shows a
 * blank placeholder until the fetch/decode/GPU-upload completes. Re-runs
 * whenever `templateSections` changes so late-registered plugin templates
 * (order vs. renderer-init race) are still covered; `preload()` dedups and
 * skips already-cached URLs, so repeat calls are cheap.
 */
export function useTemplateTexturePreload({
  rendererRef,
  status,
}: {
  rendererRef: RefObject<ViewportRenderer | null>;
  status: ViewportStatus;
}) {
  const templateSections = usePluginContribStore((s) => s.templateSections);

  useEffect(() => {
    if (status !== 'ready') return;
    const textureManager = rendererRef.current?.getTextureManager();
    if (!textureManager) return;

    const urls = new Set<string>();
    for (const section of templateSections) {
      for (const item of section.items) {
        if (item.thumbnailUrl) urls.add(item.thumbnailUrl);
      }
    }
    if (urls.size > 0) {
      void textureManager.preload([...urls]);
    }
  }, [rendererRef, status, templateSections]);
}
