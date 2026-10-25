import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '../../../config/config';
import {
  callbackUrl,
  enabledProviders,
  getProvider,
  githubProfile,
  providerIssuer,
  providerNameFor,
} from '../../../auth/services/oidc.service';

/*
 * The pure half of provider sign-in: which providers are offered, how a GitHub
 * account becomes a profile, and the callback URL whose query-stripped form
 * openid-client re-sends as `redirect_uri`. Resolving a profile to an account
 * leans on the unique identity index, so it lives in oidc.service.int.spec.ts.
 */

const saved = structuredClone(config.oidc);

const configure = (
  name: 'google' | 'github',
  values: Partial<(typeof config.oidc)['google']>,
) => Object.assign(config.oidc[name], values);

const unconfigureAll = () => {
  for (const name of ['google', 'github'] as const) {
    configure(name, { clientId: '', clientSecret: '', redirectUri: '' });
  }
};

afterEach(() => {
  Object.assign(config.oidc.google, saved.google);
  Object.assign(config.oidc.github, saved.github);
});

describe('provider enablement', () => {
  beforeEach(unconfigureAll);

  it('offers nothing when no provider is configured', () => {
    expect(enabledProviders()).toEqual([]);
    expect(getProvider('google')).toBeUndefined();
  });

  it('needs the id, the secret and the redirect URI before offering one', () => {
    configure('google', { clientId: 'id', clientSecret: 'secret' });
    expect(getProvider('google')).toBeUndefined();

    configure('google', {
      redirectUri: 'http://localhost:3000/auth/oidc/google/callback',
    });
    expect(enabledProviders()).toEqual(['google']);
    expect(getProvider('google')?.redirectUri).toBe(
      'http://localhost:3000/auth/oidc/google/callback',
    );
  });

  // The name comes straight from the URL path.
  it('refuses anything that is not a provider name', () => {
    configure('github', {
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/auth/oidc/github/callback',
    });

    for (const name of ['toString', '__proto__', 'constructor', '', 'GitHub']) {
      expect(getProvider(name)).toBeUndefined();
    }
    expect(getProvider(undefined)).toBeUndefined();
    expect(getProvider(['github'])).toBeUndefined();
  });

  it('asks Google for an ID token and GitHub for none', () => {
    configure('google', {
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/auth/oidc/google/callback',
    });
    configure('github', {
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/auth/oidc/github/callback',
    });

    expect(getProvider('google')?.usesIdToken).toBe(true);
    expect(getProvider('github')?.usesIdToken).toBe(false);
    // Without `user:email`, /user/emails answers 404 and nobody can sign in.
    expect(getProvider('github')?.scope).toContain('user:email');
  });
});

describe('provider names', () => {
  it('maps names and stored issuers both ways', () => {
    expect(providerIssuer('google')).toBe('https://accounts.google.com');
    expect(providerIssuer('github')).toBe('https://github.com');
    expect(providerNameFor('https://github.com')).toBe('github');
    expect(providerNameFor('https://example.com')).toBeUndefined();
  });

  // Unlinking must keep working after a provider is switched off.
  it('knows an issuer whether or not the provider is configured', () => {
    unconfigureAll();
    expect(providerIssuer('github')).toBe('https://github.com');
  });

  it('has no issuer for a prototype key', () => {
    expect(providerIssuer('hasOwnProperty')).toBeUndefined();
  });
});

describe('githubProfile', () => {
  const octocat = { id: 583231, login: 'octocat', name: 'Mona Lisa Octocat' };
  const verified = {
    email: 'mona@example.test',
    primary: true,
    verified: true,
    visibility: 'private',
  };

  it('identifies the person by numeric id, which survives a rename', () => {
    const profile = githubProfile(octocat, verified);
    expect(profile.provider).toBe('https://github.com');
    expect(profile.sub).toBe('583231');
    expect(profile.preferredUsername).toBe('octocat');
  });

  it('splits the one free-text name at its first space', () => {
    const profile = githubProfile(octocat, verified);
    expect(profile.givenName).toBe('Mona');
    expect(profile.familyName).toBe('Lisa Octocat');
  });

  it('leaves the names empty when GitHub has none', () => {
    const profile = githubProfile({ ...octocat, name: null }, verified);
    expect(profile.givenName).toBeUndefined();
    expect(profile.familyName).toBeUndefined();
  });

  it('is verified only when the address it carries is', () => {
    expect(githubProfile(octocat, verified).emailVerified).toBe(true);
    expect(
      githubProfile(octocat, { ...verified, verified: false }).emailVerified,
    ).toBe(false);

    const none = githubProfile(octocat, undefined);
    expect(none.email).toBeUndefined();
    expect(none.emailVerified).toBe(false);
  });
});

describe('callbackUrl', () => {
  const registered = 'https://api.example.test/api/auth/oidc/google/callback';

  it('keeps the registered path when a proxy has stripped its prefix', () => {
    const url = callbackUrl(
      registered,
      '/auth/oidc/google/callback?code=abc&state=xyz',
    );
    expect(url.href).toBe(`${registered}?code=abc&state=xyz`);
  });

  it('strips back to exactly the registered redirect URI', () => {
    const url = callbackUrl(registered, '/whatever?code=abc');
    url.search = '';
    expect(url.href).toBe(registered);
  });

  it('takes nothing but the query from the request', () => {
    const url = callbackUrl(registered, 'https://evil.example/x?code=abc');
    expect(url.origin).toBe('https://api.example.test');
    expect(url.searchParams.get('code')).toBe('abc');
  });
});
