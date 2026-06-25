import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from './index';
import { checkForUpdate } from './updateService';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/lin51kevin/worldeditor/releases/latest';

function releaseResponse(tagName: string, overrides?: { body?: string | null; html_url?: string }) {
  return new Response(
    JSON.stringify({
      tag_name: tagName,
      html_url: overrides?.html_url ?? 'https://example.com/release',
      body: overrides?.body,
    }),
    { status: 200 },
  );
}

describe('checkForUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the GitHub releases API with the expected headers and timeout', async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(releaseResponse('v99.0.0'));

    await checkForUpdate();

    expect(timeoutSpy).toHaveBeenCalledWith(8000);
    expect(fetchSpy).toHaveBeenCalledWith(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: timeoutSignal,
    });
  });

  it('returns update information when a newer release is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      releaseResponse('v0.4.0', {
        html_url: 'https://github.com/lin51kevin/worldeditor/releases/tag/v0.4.0',
        body: 'Bug fixes and improvements',
      }),
    );

    await expect(checkForUpdate()).resolves.toEqual({
      latestVersion: '0.4.0',
      releaseUrl: 'https://github.com/lin51kevin/worldeditor/releases/tag/v0.4.0',
      releaseNotes: 'Bug fixes and improvements',
    });
  });

  it('treats longer semver strings as newer versions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(releaseResponse('v0.3.2.1', { body: 'Patch metadata' }));

    await expect(checkForUpdate()).resolves.toEqual({
      latestVersion: '0.3.2.1',
      releaseUrl: 'https://example.com/release',
      releaseNotes: 'Patch metadata',
    });
  });

  it.each([
    [`v${APP_VERSION}`, 'same version'],
    ['v0.1.0', 'older patch version'],
    ['v0.1', 'shorter version'],
  ])('returns null when the latest tag is %s (%s)', async (tagName) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(releaseResponse(tagName));

    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it('falls back to empty release notes when the release body is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(releaseResponse('v99.0.0'));

    await expect(checkForUpdate()).resolves.toEqual({
      latestVersion: '99.0.0',
      releaseUrl: 'https://example.com/release',
      releaseNotes: '',
    });
  });

  it('returns null when the request fails or GitHub responds with a non-ok status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 503 }));

    await expect(checkForUpdate()).resolves.toBeNull();
    await expect(checkForUpdate()).resolves.toBeNull();
  });
});
