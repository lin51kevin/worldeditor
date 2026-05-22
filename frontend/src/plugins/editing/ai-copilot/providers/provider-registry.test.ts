import { describe, expect, it } from 'vitest';
import { PROVIDER_PRESETS, getPreset, presetToConfig } from './provider-registry';

describe('provider-registry', () => {
  it('contains presets with a valid structure', () => {
    expect(PROVIDER_PRESETS.length).toBeGreaterThan(0);

    for (const preset of PROVIDER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(['cloud', 'local']).toContain(preset.type);
      expect(Array.isArray(preset.models)).toBe(true);
      expect(typeof preset.baseUrl).toBe('string');

      if (preset.models.length > 0) {
        expect(preset.models).toContain(preset.defaultModel);
      } else {
        expect(preset.defaultModel).toBe('');
      }
    }
  });

  it('returns the correct preset by id', () => {
    const preset = getPreset('openai');

    expect(preset).toMatchObject({
      id: 'openai',
      name: 'OpenAI',
      type: 'cloud',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  it('converts a preset into a provider config', () => {
    const preset = getPreset('ollama');
    expect(preset).toBeDefined();

    const config = presetToConfig(preset!, 'local-key');

    expect(config).toEqual({
      id: 'ollama',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'local-key',
      model: 'qwen2.5:14b',
    });
  });

  it('returns undefined for an unknown preset id', () => {
    expect(getPreset('missing-provider')).toBeUndefined();
  });
});
