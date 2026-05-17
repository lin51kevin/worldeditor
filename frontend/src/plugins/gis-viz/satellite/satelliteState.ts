import { create } from 'zustand';

export type SatelliteStyle = 'hybrid' | 'survey' | 'mono';

interface SatelliteOverlayState {
  enabled: boolean;
  opacity: number;
  style: SatelliteStyle;
  setEnabled: (enabled: boolean) => void;
  setOpacity: (opacity: number) => void;
  setStyle: (style: SatelliteStyle) => void;
  toggle: () => void;
}

export const useSatelliteOverlayStore = create<SatelliteOverlayState>((set) => ({
  enabled: false,
  opacity: 0.55,
  style: 'hybrid',
  setEnabled: (enabled) => set(() => ({ enabled })),
  setOpacity: (opacity) => set(() => ({ opacity })),
  setStyle: (style) => set(() => ({ style })),
  toggle: () => set((state) => ({ enabled: !state.enabled })),
}));

export function applySatelliteOverlay(canvas?: HTMLCanvasElement | null): void {
  if (!canvas) {
    return;
  }

  const { enabled, opacity, style } = useSatelliteOverlayStore.getState();
  if (!enabled) {
    canvas.style.backgroundImage = '';
    canvas.style.backgroundSize = '';
    canvas.style.backgroundBlendMode = '';
    return;
  }

  const alpha = Math.max(0.1, Math.min(opacity, 0.9));
  const styles: Record<SatelliteStyle, string> = {
    hybrid: `radial-gradient(circle at 20% 30%, rgba(208, 200, 162, ${alpha}) 0%, rgba(96, 117, 92, ${alpha * 0.8}) 38%, rgba(44, 59, 70, ${alpha * 0.9}) 100%), linear-gradient(135deg, rgba(255,255,255,0.04) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.04) 75%, transparent 75%, transparent)`,
    survey: `linear-gradient(0deg, rgba(27, 48, 44, ${alpha}) 0%, rgba(72, 104, 90, ${alpha * 0.85}) 45%, rgba(176, 171, 136, ${alpha * 0.85}) 100%), repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 38px), repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 38px)`,
    mono: `linear-gradient(180deg, rgba(26, 28, 31, ${alpha}) 0%, rgba(86, 93, 99, ${alpha * 0.75}) 100%), repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 8px, transparent 8px 16px)`,
  };

  canvas.style.backgroundImage = styles[style];
  canvas.style.backgroundSize = style === 'hybrid' ? 'cover, 36px 36px' : 'cover, 40px 40px, 40px 40px';
  canvas.style.backgroundBlendMode = 'multiply';
}