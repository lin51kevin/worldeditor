import { useState } from 'react';
import { useProjectStore } from '../../../stores/projectStore';
import { executeScriptCommand } from './scriptingUtils';
import './ScriptingPanel.css';

interface LogEntry {
  command: string;
  output: string;
}

export default function ScriptingPanel() {
  const project = useProjectStore((state) => state.project);
  const setProject = useProjectStore((state) => state.setProject);
  const [command, setCommand] = useState('project.summary');
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

  const runCommand = () => {
    const result = executeScriptCommand(project, command);
    setProject(result.nextProject);
    setLogEntries((entries) => [{ command, output: result.output }, ...entries].slice(0, 10));
  };

  return (
    <div className="scripting-panel">
      <h3 className="scripting-panel__title">Command Console</h3>
      <p className="scripting-panel__hint">Safe commands only. Try `help`, `project.summary`, `roads.list`, `project.rename Demo`, `traffic.deploySignals`.</p>
      <div className="scripting-panel__controls">
        <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Enter command" />
        <button type="button" onClick={runCommand}>Run</button>
      </div>
      <div className="scripting-panel__log">
        {logEntries.length === 0 ? (
          <div className="scripting-panel__empty">No commands executed yet.</div>
        ) : logEntries.map((entry, index) => (
          <div className="scripting-panel__entry" key={`${entry.command}-${index}`}>
            <div className="scripting-panel__command">&gt; {entry.command}</div>
            <pre className="scripting-panel__output">{entry.output}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}