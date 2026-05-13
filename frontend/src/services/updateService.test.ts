import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate } from './updateService';
import { APP_VERSION } from './index';

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null when response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 404 }),
    );
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null when latest version equals current', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: `v${APP_VERSION}`, html_url: 'https://example.com', body: '' }),
        { status: 200 },
      ),
    );
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null when latest version is older than current', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ tag_name: 'v0.0.1', html_url: 'https://example.com', body: '' }),
        { status: 200 },
      ),
    );
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns UpdateInfo when a newer version is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          tag_name: 'v99.0.0',
          html_url: 'https://github.com/releases/v99',
          body: 'Release notes',
        }),
        { status: 200 },
      ),
    );
    const result = await checkForUpdate();
    expect(result).not.toBeNull();
    expect(result?.latestVersion).toBe('99.0.0');
    expect(result?.releaseUrl).toBe('https://github.com/releases/v99');
    expect(result?.releaseNotes).toBe('Release notes');
  });
});
