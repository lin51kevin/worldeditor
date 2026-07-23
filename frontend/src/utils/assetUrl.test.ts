import { describe, it, expect } from 'vitest';
import { getAssetUrl, initAssetResolver } from './assetUrl';

describe('assetUrl', () => {
  describe('initAssetResolver', () => {
    it('resolves without error (no-op)', async () => {
      await expect(initAssetResolver()).resolves.toBeUndefined();
    });
  });

  describe('getAssetUrl', () => {
    it('prepends a leading slash to a relative path', () => {
      expect(getAssetUrl('assets/textures/manifest.json')).toBe('/assets/textures/manifest.json');
    });

    it('normalizes a path that already has a leading slash', () => {
      expect(getAssetUrl('/config/intents.json')).toBe('/config/intents.json');
    });

    it('returns absolute http URLs as-is', () => {
      expect(getAssetUrl('https://example.com/file.png')).toBe('https://example.com/file.png');
    });

    it('returns blob URLs as-is', () => {
      expect(getAssetUrl('blob:http://localhost/abc')).toBe('blob:http://localhost/abc');
    });

    it('returns data URLs as-is', () => {
      expect(getAssetUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    });
  });
});
