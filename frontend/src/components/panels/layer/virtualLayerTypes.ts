import type { LaneSide } from '../../../utils/sceneGraph';

/**
 * Represents a single row in the flattened virtual layer list.
 * Each node type maps to a specific row renderer.
 * `depth` indicates indentation level (0 = root, 1 = child, 2 = grandchild).
 */
export type FlatLayerItem =
  | { type: 'road'; roadId: string; roadIndex: number; depth: 0 }
  | { type: 'laneSection'; roadId: string; sectionIndex: number; depth: 1 }
  | { type: 'lane'; roadId: string; sectionIndex: number; side: LaneSide; laneId: number; laneType: string; depth: 2 }
  | { type: 'signalGroup'; roadId: string; count: number; depth: 1 }
  | { type: 'signal'; roadId: string; signalId: string; signalName: string; signalType: string; depth: 2 }
  | { type: 'objectGroup'; roadId: string; count: number; depth: 1 }
  | { type: 'object'; roadId: string; objectId: string; objectName: string; objectType: string; depth: 2 }
  | { type: 'junction'; junctionId: string; depth: 0 };

/** Fixed row height in pixels for all layer items */
export const ROW_HEIGHT = 26;

/** Pixels of indentation per depth level */
export const INDENT_PER_LEVEL = 16;
