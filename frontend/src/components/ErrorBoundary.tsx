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
}

/**
 * React ErrorBoundary — catches rendering errors in child components and displays
 * a fallback UI instead of a blank white screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private tr(key: string, fallback: string): string {
    return this.props.t?.(key, fallback) ?? fallback;
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

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
          <button
            onClick={this.handleReset}
            style={{
              padding: '0.5rem 1.25rem',
              border: '1px solid var(--color-border, #444)',
              borderRadius: 4,
              backgroundColor: 'var(--color-accent, #2563eb)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            {this.tr('errorBoundary.retry', 'Retry')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
