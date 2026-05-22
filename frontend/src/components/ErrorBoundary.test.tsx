import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function ProblemChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test explosion');
  return <div>child ok</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('renders default fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('test explosion')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Error' })).toBeInTheDocument();
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

  it('uses the translation callback for fallback labels', () => {
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
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('resets error state when retry is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    screen.getByRole('button', { name: 'Retry' }).click();

    rerender(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('child ok')).toBeInTheDocument();
  });

  it('shows detailed error information when details are expanded', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show Details' }));

    expect(screen.getByRole('button', { name: 'Hide Details' })).toBeInTheDocument();
    expect(screen.getByText(/Error: test explosion/)).toBeInTheDocument();
  });

  it('copies error details to the clipboard and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy Error' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('test explosion')));
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });
});
