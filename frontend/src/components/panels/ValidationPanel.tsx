import { useState, memo } from 'react';
import { Play, Trash2, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { validateProject, type ValidationIssue } from '../../utils/validation';
import './OutputPanel.css';

const severityIcon = {
  error: <AlertCircle size={14} style={{ color: '#f44' }} />,
  warning: <AlertTriangle size={14} style={{ color: '#fa0' }} />,
  info: <Info size={14} style={{ color: '#48f' }} />,
};

export const ValidationPanel = memo(function ValidationPanel() {
  const project = useProjectStore((s) => s.project);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  const runValidation = () => {
    setIssues(validateProject(project));
  };

  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={runValidation} style={btnStyle}>
          <Play size={14} /> Validate
        </button>
        <button onClick={() => setIssues([])} style={btnStyle}>
          <Trash2 size={14} /> Clear
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {issues.length === 0 ? (
          <div style={{ color: '#8b949e', textAlign: 'center', padding: 24 }}>
            <CheckCircle2 size={32} style={{ color: '#3fb950', marginBottom: 8 }} />
            <div>项目验证通过 ✅</div>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {issues.map((issue, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13 }}>
                {severityIcon[issue.severity]}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
});

const btnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
  border: '1px solid #30363d',
  borderRadius: 6,
  background: '#21262d',
  color: '#c9d1d9',
};
