/**
 * QuickCommands — 斜杠命令自动补全弹窗
 */
import { useState, useEffect, useCallback } from 'react';

export interface CommandItem {
  command: string;
  label: string;
  description: string;
}

interface Props {
  visible: boolean;
  commands: CommandItem[];
  onSelect: (cmd: string) => void;
  filter?: string;
}

export function QuickCommands({ visible, commands, onSelect, filter = '' }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = filter
    ? commands.filter((c) =>
        c.command.toLowerCase().includes(filter.toLowerCase()) ||
        c.label.toLowerCase().includes(filter.toLowerCase())
      )
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [filter, commands]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!visible) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        onSelect(filtered[selectedIndex]!.command + ' ');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSelect('');
    }
  }, [visible, filtered, selectedIndex, onSelect]);

  useEffect(() => {
    if (visible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  if (!visible || filtered.length === 0) return null;

  return (
    <div
      className="copilot-quick-cmds"
    >
      {filtered.map((cmd, i) => (
        <div
          key={cmd.command}
          data-testid={`quick-command-${i}`}
          onClick={() => onSelect(cmd.command + ' ')}
          className={`copilot-quick-cmd-item ${i === selectedIndex ? 'copilot-quick-cmd-item--selected' : ''}`}
        >
          <span className="copilot-quick-cmd-label">{cmd.label}</span>
          <span className="copilot-quick-cmd-desc">{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}
