import { describe, expect, test } from 'bun:test';
import { sameSiteHost, withBrowserHeaders } from '../src/downloads/hosts';
import { resolveDownload } from '../src/downloads/resolve';
import { fakeServices } from './fakes';

describe('withBrowserHeaders', () => {
  test('keeps the browser Cookie for the same non-forum URL', () => {
    const headers = withBrowserHeaders('https://gofile.io/d/abc', {}, { Cookie: 'accountToken=t' });
    expect(headers.Cookie).toBe('accountToken=t');
  });

  test('does not send a forum cookie to a non-forum host without browser headers', () => {
    const headers = withBrowserHeaders('https://gofile.io/d/abc', { Cookie: 'xf_user=secret' });
    expect(headers.Cookie).toBeUndefined();
  });

  test('keeps the session Cookie on the forum host', () => {
    const headers = withBrowserHeaders('https://f95zone.to/attachments/file.zip', { Cookie: 'xf_user=secret' });
    expect(headers.Cookie).toBe('xf_user=secret');
  });
});

describe('download host safety', () => {
  test('sameSiteHost accepts subdomains but not lookalikes', () => {
    expect(sameSiteHost('f95zone.to', 'attachments.f95zone.to')).toBe(true);
    expect(sameSiteHost('attachments.f95zone.to', 'f95zone.to')).toBe(true);
    expect(sameSiteHost('mediafire.com', 'www.mediafire.com')).toBe(true);
    expect(sameSiteHost('mediafire.com', 'evilmediafire.com')).toBe(false);
    expect(sameSiteHost('f95zone.to', 'f95zone.to.evil.com')).toBe(false);
  });

  test('resolveDownload does not mistake a lookalike host for a supported one', async () => {
    // a supported host would be fetched here; the lookalike must pass straight through
    const url = 'https://evilmediafire.com/file.zip';
    const resolved = await resolveDownload(url, { headers: {}, http: fakeServices().services.http });
    expect(resolved.url).toBe(url);
  });
});
