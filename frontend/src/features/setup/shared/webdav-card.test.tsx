import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebdavCard, checkWebdav, webdavErrorMessage } from '@/features/setup/shared/webdav-card';
import { providerSelection, providerSelectionFromServices } from '@/features/setup/shared/config-contract';

describe('WebDAV setup card', () => {
  it('is not shown unless this server allows WebDAV', () => {
    const html = renderToStaticMarkup(<WebdavCard enabled={false} values={{}} onChange={() => {}} />);
    expect(html).toBe('');
  });

  it('shows the three fields and the check button when allowed', () => {
    const html = renderToStaticMarkup(<WebdavCard enabled values={{}} onChange={() => {}} />);
    expect(html).toContain('Your own WebDAV server');
    expect(html).toContain('type="url"');
    expect(html).toContain('type="password"');
    expect(html).toContain('Check connection');
  });

  it('in edit mode a saved server shows Saved with empty fields (never revealed)', () => {
    const html = renderToStaticMarkup(
      <WebdavCard enabled values={{}} onChange={() => {}} savedServices={['webdavUrl', 'webdavUser', 'webdavPassword']} />,
    );
    expect(html).toContain('Saved');
    expect(html).not.toMatch(/value="[^"]+"/);
  });
});

describe('WebDAV connection check', () => {
  it('posts exactly the address, user and password', async () => {
    const calls: Array<[string, unknown]> = [];
    const post = async (path: string, body: unknown) => { calls.push([path, body]); return { valid: true, folders: 2, videos: 5 }; };
    const result = await checkWebdav({ webdavUrl: ' http://nas:8080/ ', webdavUser: 'me', webdavPassword: 'pw' }, post);
    expect(calls).toEqual([['/api/verify/webdav', { url: 'http://nas:8080/', user: 'me', password: 'pw' }]]);
    expect(result).toEqual({ ok: true, message: 'Connected: 5 videos in 2 folders.' });
  });

  it('turns error codes into plain messages', async () => {
    const post = async () => ({ valid: false, error: 'auth' });
    expect(await checkWebdav({ webdavUrl: 'http://nas/', webdavUser: 'me', webdavPassword: 'x' }, post))
      .toEqual({ ok: false, message: 'The username or password was not accepted.' });
    expect(webdavErrorMessage('blocked-host')).toBe('This server is on your local network. Set WEBDAV_ALLOW_PRIVATE=on for this LeLibrary install to use it.');
    expect(webdavErrorMessage('something-new')).toBe('LeLibrary could not reach this server.');
  });

  it('needs an address before checking', async () => {
    const post = async () => { throw new Error('should not be called'); };
    expect(await checkWebdav({ webdavUser: 'me' }, post)).toEqual({ ok: false, message: 'Enter the full address, starting with http:// or https://.' });
  });
});

describe('WebDAV provider selection', () => {
  it('a WebDAV address makes webdav an active provider, after the debrid ones', () => {
    expect(providerSelection({ torboxApiKey: 'x', webdavUrl: 'http://nas/' })).toBe('torbox,webdav');
    expect(providerSelectionFromServices(['webdavUrl', 'webdavPassword'])).toBe('webdav');
  });
});
