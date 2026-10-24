import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WebdavCard, checkWebdav, webdavErrorMessage, webdavRemoval } from '@/features/setup/shared/webdav-card';
import { providerSelection, providerSelectionFromServices, providerSelectionWithSaved } from '@/features/setup/shared/config-contract';
import { hubPrefix } from '@/features/setup/shared/collection-doc';

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
    expect(webdavErrorMessage('insecure-http')).toBe('Use https:// for a server outside your own network, so the password is not sent in clear text.');
    expect(webdavErrorMessage('too-large')).toBe('This WebDAV folder is too big to read in one go. Point the address at a smaller folder.');
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

describe('WebDAV library rows', () => {
  it('a WebDAV-only setup uses the dav catalogues the manifest lists', () => {
    expect(hubPrefix('webdav')).toBe('dav');
    expect(hubPrefix('torbox,webdav')).toBe('torbox');
  });

  it('editing a setup counts a saved (hidden) WebDAV server as active', () => {
    expect(providerSelectionWithSaved({}, ['webdavUrl', 'webdavUser', 'webdavPassword', 'tmdbApiKey'])).toBe('webdav');
    expect(providerSelectionWithSaved({ torboxApiKey: 'tb' }, ['webdavUrl'])).toBe('torbox,webdav');
    expect(providerSelectionWithSaved({ rdApiKey: 'rd' })).toBe('realdebrid');
  });
});

describe('removing a WebDAV server', () => {
  it('a saved server offers a remove button', () => {
    const html = renderToStaticMarkup(
      <WebdavCard enabled values={{}} onChange={() => {}} onRemove={() => {}} savedServices={['webdavUrl', 'webdavUser', 'webdavPassword']} />,
    );
    expect(html).toContain('Remove this server');
  });

  it('removal clears all three fields and asks the server to forget the saved ones', () => {
    expect(webdavRemoval({ torboxApiKey: 'tb', webdavUrl: 'http://nas/', webdavUser: 'me' }, ['webdavUrl', 'webdavUser', 'webdavPassword', 'tmdbApiKey']))
      .toEqual({ next: { torboxApiKey: 'tb' }, clear: ['webdavUrl', 'webdavUser', 'webdavPassword'] });
  });
});
