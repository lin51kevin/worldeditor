import { describe, it, expect, beforeEach } from 'vitest';
import { useBuiltinPluginStore } from './builtinPluginStore';

describe('builtinPluginStore', () => {
  beforeEach(() => {
    useBuiltinPluginStore.setState({ disabledBuiltins: [] });
  });

  describe('disableBuiltin', () => {
    it('should add id to disabledBuiltins', () => {
      useBuiltinPluginStore.getState().disableBuiltin('plugin-a');
      expect(useBuiltinPluginStore.getState().disabledBuiltins).toContain('plugin-a');
    });

    it('should be idempotent — not duplicate on double disable', () => {
      useBuiltinPluginStore.getState().disableBuiltin('plugin-a');
      useBuiltinPluginStore.getState().disableBuiltin('plugin-a');
      const disabled = useBuiltinPluginStore.getState().disabledBuiltins;
      expect(disabled.filter((id) => id === 'plugin-a').length).toBe(1);
    });

    it('should not affect other plugins', () => {
      useBuiltinPluginStore.getState().disableBuiltin('plugin-a');
      expect(useBuiltinPluginStore.getState().isDisabled('plugin-b')).toBe(false);
    });
  });

  describe('enableBuiltin', () => {
    it('should remove id from disabledBuiltins', () => {
      useBuiltinPluginStore.getState().disableBuiltin('plugin-a');
      useBuiltinPluginStore.getState().enableBuiltin('plugin-a');
      expect(useBuiltinPluginStore.getState().disabledBuiltins).not.toContain('plugin-a');
    });

    it('should do nothing if id was not disabled', () => {
      expect(() => useBuiltinPluginStore.getState().enableBuiltin('unknown')).not.toThrow();
    });
  });

  describe('isDisabled', () => {
    it('should return true when disabled', () => {
      useBuiltinPluginStore.getState().disableBuiltin('plugin-x');
      expect(useBuiltinPluginStore.getState().isDisabled('plugin-x')).toBe(true);
    });

    it('should return false when not disabled', () => {
      expect(useBuiltinPluginStore.getState().isDisabled('plugin-x')).toBe(false);
    });

    it('should reflect enable after disable', () => {
      useBuiltinPluginStore.getState().disableBuiltin('p');
      useBuiltinPluginStore.getState().enableBuiltin('p');
      expect(useBuiltinPluginStore.getState().isDisabled('p')).toBe(false);
    });
  });
});
