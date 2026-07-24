/**
 * External Validation panel — runs project validation and lists issues.
 *
 * Trusted first-party plugin: reads reactive project state from the host's
 * shared project store, and reuses the host's pure validateProject util.
 */

import { useState, memo } from 'react';
import { Play, Trash2, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useProjectStore } from '../host';
import { validateProject, type ValidationIssue } from '../../utils/validation';

const severityIcon = {
  error: <AlertCircle size={14} className="validation-panel__icon--error" />,
  warning: <AlertTriangle size={14} className="validation-panel__icon--warning" />,
  info: <Info size={14} className="validation-panel__icon--info" />,
};

export const ValidationPanel = memo(function ValidationPanel() {
  const project = useProjectStore((s) => s.project);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  const runValidation = () => {
    setIssues(validateProject(project));
  };

  return (
    <div className="validation-panel">
      <div className="validation-panel__toolbar">
        <button onClick={runValidation} className="validation-panel__btn">
          <Play size={14} /> Validate
        </button>
        <button onClick={() => setIssues([])} className="validation-panel__btn">
          <Trash2 size={14} /> Clear
        </button>
      </div>

      <div className="validation-panel__body">
        {issues.length === 0 ? (
          <div className="validation-panel__empty">
            <CheckCircle2 size={32} className="validation-panel__empty-icon" />
            <div>项目验证通过 ✅</div>
          </div>
        ) : (
          <ul className="validation-panel__issues">
            {issues.map((issue, i) => (
              <li key={i} className="validation-panel__issue">
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
