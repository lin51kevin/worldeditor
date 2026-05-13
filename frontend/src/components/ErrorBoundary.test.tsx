import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test explosion');
  return <div>child ok</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders default fallback when child throws', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('test explosion')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Copy Error')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>custom error</div>}>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom error')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('uses t function for translating labels', () => {
    const t = vi.fn((key: string, fallback?: string) => {
      if (key === 'errorBoundary.title') return '出错了';
      if (key === 'errorBoundary.retry') return '重试';
      return fallback ?? key;
    });

    render(
      <ErrorBoundary t={t}>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('出错了')).toBeInTheDocument();
    expect(screen.getByText('重试')).toBeInTheDocument();
  });

  it('resets error state when retry is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Use native .click() so state update + rerender are batched together
    // (fireEvent.click flushes via act(), which causes children to re-throw before rerender)
    screen.getByText('Retry').click();

    // After reset, re-rendering with non-throwing child should work
    rerender(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('child ok')).toBeInTheDocument();
  });

  it('shows "Show Details" button and toggles detail view', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );
    const showDetail = screen.getByText('Show Details');
    expect(showDetail).toBeInTheDocument();

    fireEvent.click(showDetail);
    expect(screen.getByText('Hide Details')).toBeInTheDocument();
  });

  it('copies error to clipboard when "Copy Error" is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText('Copy Error'));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});
