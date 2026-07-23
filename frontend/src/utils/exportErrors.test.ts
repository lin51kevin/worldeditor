import { describe, it, expect } from 'vitest';
import { ExportCancelledError, isExportCancelled } from './exportErrors';

describe('ExportCancelledError', () => {
  it('creates an error with the expected name and message', () => {
    const err = new ExportCancelledError();
    expect(err.name).toBe('ExportCancelledError');
    expect(err.message).toBe('Export cancelled by user');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('isExportCancelled', () => {
  it('returns true for an ExportCancelledError instance', () => {
    expect(isExportCancelled(new ExportCancelledError())).toBe(true);
  });

  it('returns true for an Error with name ExportCancelledError', () => {
    const err = new Error('something');
    err.name = 'ExportCancelledError';
    expect(isExportCancelled(err)).toBe(true);
  });

  it('returns false for a generic error', () => {
    expect(isExportCancelled(new Error('oops'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isExportCancelled(null)).toBe(false);
    expect(isExportCancelled(undefined)).toBe(false);
    expect(isExportCancelled('string')).toBe(false);
  });
});
