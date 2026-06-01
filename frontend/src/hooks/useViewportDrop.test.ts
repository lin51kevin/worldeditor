import { describe, it, expect } from 'vitest';
import { ACCEPTED_EXTENSIONS } from './useViewportDrop';

describe('useViewportDrop – accepted extensions', () => {
  it('should include .geoz and .zip alongside .xodr and .xml', () => {
    expect(ACCEPTED_EXTENSIONS).toContain('.xodr');
    expect(ACCEPTED_EXTENSIONS).toContain('.xml');
    expect(ACCEPTED_EXTENSIONS).toContain('.geoz');
    expect(ACCEPTED_EXTENSIONS).toContain('.zip');
  });

  it('should accept files by extension case-insensitively', () => {
    function isAccepted(name: string): boolean {
      const lower = name.toLowerCase();
      return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    }

    expect(isAccepted('road.xodr')).toBe(true);
    expect(isAccepted('road.XML')).toBe(true);
    expect(isAccepted('map.geoz')).toBe(true);
    expect(isAccepted('scene.GEOZ')).toBe(true);
    expect(isAccepted('package.zip')).toBe(true);
    expect(isAccepted('PACKAGE.ZIP')).toBe(true);
    expect(isAccepted('road.json')).toBe(false);
    expect(isAccepted('image.png')).toBe(false);
    expect(isAccepted('readme.md')).toBe(false);
  });
});
