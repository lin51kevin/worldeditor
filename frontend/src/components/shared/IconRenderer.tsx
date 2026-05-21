import React from 'react';
import {
  Scissors,
  Link2,
  Ruler,
  Footprints,
  Trash2,
  Diamond,
  PanelTop,
  ArrowLeftRight,
  TrafficCone,
} from 'lucide-react';

const iconMap: Record<string, React.FC<{ size?: number; className?: string }>> = {
  Scissors,
  Link2,
  Ruler,
  Footprints,
  Trash2,
  Diamond,
  PanelTop,
  ArrowLeftRight,
  TrafficCone,
};

/**
 * Resolve an icon name string to a Lucide component.
 * Passes through ReactNode (e.g. already-rendered Lucide elements) unchanged.
 */
export function resolveIcon(
  icon: React.ReactNode,
  size = 16,
  className?: string,
): React.ReactNode {
  if (typeof icon !== 'string') return icon;
  const Component = iconMap[icon];
  if (Component) {
    return <Component size={size} className={className} />;
  }
  return <span className={className}>{icon}</span>;
}
