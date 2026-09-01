import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import catalog from './defaultCatalog';
import en from '../../../i18n/locales/en.json';
import zh from '../../../i18n/locales/zh.json';

function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    bundle,
  );
}

const labelKeys = [...catalog.roads, ...catalog.junctions].map((t) => t.labelKey);

describe('road & junction template i18n', () => {
  it.each(labelKeys)('has an English label for %s', (key) => {
    expect(typeof lookup(en, key)).toBe('string');
  });

  it.each(labelKeys)('has a Chinese label for %s', (key) => {
    expect(typeof lookup(zh, key)).toBe('string');
  });
});

describe('road & junction template thumbnails', () => {
  const thumbnails = [...catalog.roads, ...catalog.junctions]
    .map((t) => t.thumbnailUrl)
    .filter((url): url is string => typeof url === 'string');

  it('references at least one thumbnail per category', () => {
    expect(thumbnails.length).toBeGreaterThan(0);
  });

  it.each(thumbnails)('has the asset file for %s', (url) => {
    expect(existsSync(resolve(__dirname, '../../../../public', url.replace(/^\//, '')))).toBe(true);
  });
});
