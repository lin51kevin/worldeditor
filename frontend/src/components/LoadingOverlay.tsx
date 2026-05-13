import { useLoadingStore } from '../stores/loadingStore';
import './LoadingOverlay.css';

export function LoadingOverlay() {
  const { isLoading, message } = useLoadingStore();
  if (!isLoading) return null;
  return (
    <div className="loading-overlay" role="alert" aria-live="assertive">
      <div className="loading-spinner" />
      <div className="loading-message">{message}</div>
    </div>
  );
}
