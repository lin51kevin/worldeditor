/**
 * RoadActionPreview — 道路操作预览卡片
 */
import type { ActionResult } from '../core/action-executor';

interface Props {
  result: ActionResult | null;
  onApply?: () => void;
}

export function RoadActionPreview({ result, onApply: _onApply }: Props) {
  if (!result) return null;

  const isSuccess = result.success;

  return (
    <div className={`copilot-action-card ${isSuccess ? 'copilot-action-success' : 'copilot-action-error'}`}>
      <span className={`copilot-action-icon ${isSuccess ? 'copilot-action-icon--success' : 'copilot-action-icon--error'}`}>
        {isSuccess ? '✓' : '✗'}
      </span>
      <div style={{ flex: 1 }}>
        {result.description && (
          <div className="copilot-action-desc">{result.description}</div>
        )}
        {result.error && (
          <div className="copilot-action-error-text">{result.error}</div>
        )}
      </div>
    </div>
  );
}
