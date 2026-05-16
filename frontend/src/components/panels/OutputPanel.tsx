import { useState, useEffect, useRef, memo } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useViewportStore } from '../../stores/viewportStore';
import './OutputPanel.css';

interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export const OutputPanel = memo(function OutputPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toggleOutputPanel = useViewportStore((s) => s.toggleOutputPanel);

  // Auto-scroll on new entries
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [logs]);

  // Listen for custom log events from the app
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Omit<LogEntry, 'timestamp'>>).detail;
      const entry: LogEntry = {
        ...detail,
        timestamp: new Date().toLocaleTimeString(),
      };
      setLogs((prev) => [...prev.slice(-499), entry]);
    };
    window.addEventListener('we-log', handler);
    return () => window.removeEventListener('we-log', handler);
  }, []);

  return (
    <div className="output-panel">
      <div className="output-header">
        <span className="output-title">Output</span>
        <div className="output-actions">
          <button className="output-btn" title="Clear" onClick={() => setLogs([])}>
            <Trash2 size={12} />
          </button>
          <button className="output-btn" title="Close" onClick={toggleOutputPanel}>
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="output-body" ref={scrollRef}>
        {logs.length === 0 ? (
          <div className="output-empty">No output</div>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className={`output-line level-${entry.level}`}>
              <span className="output-time">{entry.timestamp}</span>
              <span className="output-msg">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
