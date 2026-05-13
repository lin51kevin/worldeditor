import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI. If provided, the default error screen is not shown. */
  fallback?: ReactNode;
  /** Optional i18n lookup function for translating strings. */
  t?: (key: string, fallback?: string) => string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /** Full error stack + component stack for display */
  errorDetail: string;
  copied: boolean;
  showDetail: boolean;
}

/**
 * React ErrorBoundary — catches rendering errors in child components and displays
 * a fallback UI with copy-error button and collapsible stack trace.
 *
 * Also works in tandem with the global error/unhandledrejection handlers
 * registered in main.tsx to cover non-React errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorDetail: '', copied: false, showDetail: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const detail = [
      `Error: ${error.message}`,
      error.stack ?? '',
      info.componentStack ? `\nComponent Stack:${info.componentStack}` : '',
    ].join('\n');
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ errorDetail: detail });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorDetail: '', copied: false, showDetail: false });
  };

  handleCopy = () => {
    const text = this.state.errorDetail || this.state.error?.message || 'Unknown error';
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    }).catch(() => {
      // Fallback: show text selection
    });
  };

  handleToggleDetail = () => {
    this.setState((s) => ({ showDetail: !s.showDetail }));
  };

  private tr(key: string, fallback: string): string {
    return this.props.t?.(key, fallback) ?? fallback;
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const btnBase: React.CSSProperties = {
        padding: '0.4rem 1rem',
        border: '1px solid var(--color-border, #444)',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: '0.875rem',
      };

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100%',
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--color-text-primary, #e0e0e0)',
            backgroundColor: 'var(--color-bg-primary, #1e1e1e)',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            {this.tr('errorBoundary.title', 'Something went wrong')}
          </h2>
          <p
            style={{
              color: 'var(--color-text-secondary, #999)',
              marginBottom: '1rem',
              maxWidth: 480,
            }}
          >
            {this.state.error?.message ||
              this.tr('errorBoundary.unknownError', 'An unexpected error occurred.')}
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={this.handleReset}
              style={{ ...btnBase, backgroundColor: 'var(--color-accent, #2563eb)', color: '#fff' }}
            >
              {this.tr('errorBoundary.retry', 'Retry')}
            </button>
            <button
              onClick={this.handleCopy}
              style={{ ...btnBase, backgroundColor: 'var(--color-bg-secondary, #2a2a2a)', color: 'var(--color-text-primary, #e0e0e0)' }}
            >
              {this.state.copied ? this.tr('errorBoundary.copied', 'Copied!') : this.tr('errorBoundary.copyError', 'Copy Error')}
            </button>
            {this.state.errorDetail && (
              <button
                onClick={this.handleToggleDetail}
                style={{ ...btnBase, backgroundColor: 'transparent', color: 'var(--color-text-secondary, #999)' }}
              >
                {this.state.showDetail
                  ? this.tr('errorBoundary.hideDetail', 'Hide Details')
                  : this.tr('errorBoundary.showDetail', 'Show Details')}
              </button>
            )}
          </div>
          {this.state.showDetail && this.state.errorDetail && (
            <pre
              style={{
                maxWidth: 680,
                maxHeight: 300,
                overflowY: 'auto',
                overflowX: 'auto',
                textAlign: 'left',
                fontSize: '0.75rem',
                padding: '0.75rem',
                backgroundColor: 'var(--color-bg-secondary, #111)',
                border: '1px solid var(--color-border, #333)',
                borderRadius: 4,
                color: '#f87171',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.errorDetail}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
