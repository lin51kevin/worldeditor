import { describe, expect, it, beforeEach } from 'vitest';
import { useLoadingStore } from './loadingStore';

describe('loadingStore', () => {
  beforeEach(() => {
    useLoadingStore.setState({ isLoading: false, message: '', _count: 0 });
  });

  it('starts with isLoading false', () => {
    expect(useLoadingStore.getState().isLoading).toBe(false);
  });

  it('showLoading sets isLoading to true with message', () => {
    useLoadingStore.getState().showLoading('Importing...');
    expect(useLoadingStore.getState().isLoading).toBe(true);
    expect(useLoadingStore.getState().message).toBe('Importing...');
  });

  it('showLoading uses default message when none provided', () => {
    useLoadingStore.getState().showLoading();
    expect(useLoadingStore.getState().message).toBe('Loading...');
  });

  it('hideLoading sets isLoading to false', () => {
    useLoadingStore.getState().showLoading('test');
    useLoadingStore.getState().hideLoading();
    expect(useLoadingStore.getState().isLoading).toBe(false);
    expect(useLoadingStore.getState().message).toBe('');
  });

  it('reference count: multiple showLoading + one hideLoading still shows', () => {
    useLoadingStore.getState().showLoading('A');
    useLoadingStore.getState().showLoading('B');
    useLoadingStore.getState().hideLoading();
    expect(useLoadingStore.getState().isLoading).toBe(true);
    expect(useLoadingStore.getState()._count).toBe(1);
  });

  it('reference count: showLoading 3x + hideLoading 3x closes overlay', () => {
    useLoadingStore.getState().showLoading('A');
    useLoadingStore.getState().showLoading('B');
    useLoadingStore.getState().showLoading('C');
    useLoadingStore.getState().hideLoading();
    expect(useLoadingStore.getState().isLoading).toBe(true);
    useLoadingStore.getState().hideLoading();
    expect(useLoadingStore.getState().isLoading).toBe(true);
    useLoadingStore.getState().hideLoading();
    expect(useLoadingStore.getState().isLoading).toBe(false);
    expect(useLoadingStore.getState()._count).toBe(0);
  });

  it('hideLoading never makes count negative', () => {
    useLoadingStore.getState().hideLoading();
    useLoadingStore.getState().hideLoading();
    expect(useLoadingStore.getState()._count).toBe(0);
    expect(useLoadingStore.getState().isLoading).toBe(false);
  });

  it('first showLoading message is preserved, subsequent calls do not overwrite', () => {
    useLoadingStore.getState().showLoading('First message');
    useLoadingStore.getState().showLoading('Second message');
    expect(useLoadingStore.getState().message).toBe('First message');
  });
});
