export interface ShortcutHelpRow {
  keys: readonly string[];
  descKey: string;
}

export interface ShortcutHelpSection {
  titleKey: string;
  rows: readonly ShortcutHelpRow[];
}

export const SHORTCUT_HELP_SECTIONS: readonly ShortcutHelpSection[] = [
  {
    titleKey: 'shortcutHelp.sections.navigation',
    rows: [
      { keys: ['RMB+Drag'],   descKey: 'shortcutHelp.keys.flyLook' },
      { keys: ['RMB+WASD'],   descKey: 'shortcutHelp.keys.flyMove' },
      { keys: ['RMB+Q/E'],    descKey: 'shortcutHelp.keys.flyUpDown' },
      { keys: ['RMB+Shift'],  descKey: 'shortcutHelp.keys.flySprint' },
      { keys: ['RMB+Scroll'], descKey: 'shortcutHelp.keys.flySpeed' },
      { keys: ['Alt+LMB'],    descKey: 'shortcutHelp.keys.orbit' },
      { keys: ['MMB+Drag'], descKey: 'shortcutHelp.keys.pan' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.drawing',
    rows: [
      { keys: ['A'], descKey: 'shortcutHelp.keys.drawArc' },
      { keys: ['P'], descKey: 'shortcutHelp.keys.drawSpiral' },
      { keys: ['S'], descKey: 'shortcutHelp.keys.drawSpline' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.transform',
    rows: [
      { keys: ['E'], descKey: 'shortcutHelp.keys.geometryEdit' },
      { keys: ['M'], descKey: 'shortcutHelp.keys.moveRoad' },
      { keys: ['R'], descKey: 'shortcutHelp.keys.rotateRoad' },
      { keys: ['X'], descKey: 'shortcutHelp.keys.splitRoadAtPoint' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.edit',
    rows: [
      { keys: ['Ctrl+Z'], descKey: 'shortcutHelp.keys.undo' },
      { keys: ['Ctrl+Y'], descKey: 'shortcutHelp.keys.redo' },
      { keys: ['Ctrl+A'], descKey: 'shortcutHelp.keys.selectAll' },
      { keys: ['Ctrl+C'], descKey: 'shortcutHelp.keys.copy' },
      { keys: ['Ctrl+V'], descKey: 'shortcutHelp.keys.paste' },
      { keys: ['Delete', 'Backspace'], descKey: 'shortcutHelp.keys.delete' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.view',
    rows: [
      { keys: ['F'], descKey: 'shortcutHelp.keys.zoomFit' },
      { keys: ['V'], descKey: 'shortcutHelp.keys.selectMode' },
      { keys: ['T'], descKey: 'shortcutHelp.keys.toggleRoadLinks' },
      { keys: ['Esc'], descKey: 'shortcutHelp.keys.escape' },
    ],
  },
  {
    titleKey: 'shortcutHelp.sections.panels',
    rows: [
      { keys: ['I'], descKey: 'shortcutHelp.keys.inspector' },
      { keys: ['Ctrl+B'], descKey: 'shortcutHelp.keys.leftPanel' },
      { keys: ['Ctrl+J'], descKey: 'shortcutHelp.keys.outputPanel' },
      { keys: ['Ctrl+Shift+V'], descKey: 'shortcutHelp.keys.validationPanel' },
      { keys: ['/', '?'], descKey: 'shortcutHelp.keys.help' },
    ],
  },
];

export function isShortcutHelpTrigger(event: Pick<KeyboardEvent, 'key' | 'code'>): boolean {
  return event.code === 'Slash' || event.key === '/' || event.key === '?' || event.key === '？';
}