import { beforeEach, describe, expect, it } from 'vitest';
import { applySatelliteOverlay, useSatelliteOverlayStore } from './satelliteState';

beforeEach(() => {
  useSatelliteOverlayStore.setState({ enabled: false, opacity: 0.55, style: 'hybrid' });
});

describe('useSatelliteOverlayStore', () => {
  it('starts with the expected defaults', () => {
    expect(useSatelliteOverlayStore.getState()).toMatchObject({
      enabled: false,
      opacity: 0.55,
      style: 'hybrid',
    });
  });

  it('updates enabled, opacity and style through its actions', () => {
    const state = useSatelliteOverlayStore.getState();

    state.setEnabled(true);
    state.setOpacity(0.7);
    state.setStyle('mono');
    state.toggle();

    expect(useSatelliteOverlayStore.getState()).toMatchObject({
      enabled: false,
      opacity: 0.7,
      style: 'mono',
    });
  });
});

describe('applySatelliteOverlay', () => {
  it('does nothing when no canvas is provided', () => {
    expect(() => applySatelliteOverlay(null)).not.toThrow();
    expect(() => applySatelliteOverlay(undefined)).not.toThrow();
  });

  it('clears overlay styles when the overlay is disabled', () => {
    const canvas = document.createElement('canvas');
    canvas.style.backgroundImage = 'preset';
    canvas.style.backgroundSize = '10px 10px';
    canvas.style.backgroundBlendMode = 'screen';

    applySatelliteOverlay(canvas);

    expect(canvas.style.backgroundImage).toBe('');
    expect(canvas.style.backgroundSize).toBe('');
    expect(canvas.style.backgroundBlendMode).toBe('');
  });

  it.each([
    ['hybrid', 'cover, 36px 36px', 'radial-gradient'],
    ['survey', 'cover, 40px 40px, 40px 40px', 'linear-gradient(0deg'],
    ['mono', 'cover, 40px 40px, 40px 40px', 'linear-gradient(180deg'],
  ] as const)('applies %s overlay styling to the canvas', (style, expectedSize, expectedSnippet) => {
    const canvas = document.createElement('canvas');
    useSatelliteOverlayStore.setState({ enabled: true, opacity: 0.6, style });

    applySatelliteOverlay(canvas);

    expect(canvas.style.backgroundImage).toContain(expectedSnippet);
    expect(canvas.style.backgroundSize).toBe(expectedSize);
    expect(canvas.style.backgroundBlendMode).toBe('multiply');
  });

  it('clamps opacity into the supported 0.1-0.9 range', () => {
    const canvas = document.createElement('canvas');
    useSatelliteOverlayStore.setState({ enabled: true, opacity: 5, style: 'mono' });

    applySatelliteOverlay(canvas);

    expect(canvas.style.backgroundImage).toContain('0.9');
  });
});
