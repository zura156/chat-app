import * as client from 'openid-client';
import crypto from 'crypto';
import config from '../../config/config';
import { IUser, User } from '../../user/models/user.model';
import { normalizeEmail } from './auth.service';

export type ProviderName = 'google' | 'github';

/**
 * What every provider is reduced to before an account is looked up, so the
 * account logic below never has to know whether the facts came from a signed
 * ID token (Google) or from a REST API called with an access token (GitHub).
 */
export interface ExternalProfile {
  /** The issuer. Together with `sub`, the pair that identifies a person. */
  provider: string;
  sub: string;
  email?: string;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
  /** A handle the provider already knows them by — GitHub's `login`. */
  preferredUsername?: string;
}

type Tokens = Awaited<ReturnType<typeof client.authorizationCodeGrant>>;

interface ProviderDefinition {
  name: ProviderName;
  issuer: string;
  scope: string;
  /**
   * Whether the provider speaks OpenID Connect. Google does, so it gets a
   * nonce and its ID token is verified. GitHub is plain OAuth 2.0: there is no
   * ID token to expect, and asking openid-client for one fails every sign-in.
   */
  usesIdToken: boolean;
  /** Sent on the authorization request in addition to the standard ones. */
  extraAuthorizationParams?: Record<string, string>;
  configure(): Promise<client.Configuration>;
  profile(tokens: Tokens): Promise<ExternalProfile>;
}

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GITHUB_ISSUER = 'https://github.com';

const credentials = (name: ProviderName) => config.oidc[name];

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

// ─── GitHub ──────────────────────────────────────────────────────────────────

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

interface GithubUser {
  /** Numeric and permanent. `login` is not: GitHub lets users rename. */
  id: number;
  login: string;
  name: string | null;
}

const githubApi = async <T>(path: string, accessToken: string): Promise<T> => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // GitHub refuses API requests that carry no User-Agent at all.
      'User-Agent': 'chat-app',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub ${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
};

/**
 * Which of a GitHub account's addresses this app should believe.
 *
 * `/user/emails` returns every address on the account, verified or not, and
 * whichever one is returned here is what an existing account gets matched
 * against — so this choice decides whose account a GitHub sign-in can land in.
 * Whatever it returns, `resolveOidcUser` still refuses to match or create an
 * account on an address whose `verified` is false.
 */
export const pickGithubEmail = (
  emails: GithubEmail[],
): GithubEmail | undefined => {
  // TODO(human): choose the address to trust, or undefined for none.
  return undefined;
};

// ─── Registry ────────────────────────────────────────────────────────────────

const PROVIDERS: Record<ProviderName, ProviderDefinition> = {
  google: {
    name: 'google',
    issuer: GOOGLE_ISSUER,
    scope: 'openid email profile',
    usesIdToken: true,
    // Without it Google silently reuses whichever account the browser last
    // used, and a user with a work and a personal account cannot pick.
    extraAuthorizationParams: { prompt: 'select_account' },
    configure: () => {
      const { clientId, clientSecret } = credentials('google');
      return client.discovery(new URL(GOOGLE_ISSUER), clientId, clientSecret);
    },
    profile: async (tokens) => {
      const claims = tokens.claims();
      if (!claims) throw new Error('Google returned no ID token');
      return {
        provider: GOOGLE_ISSUER,
        sub: claims.sub,
        email: optionalString(claims.email),
        emailVerified: claims.email_verified === true,
        givenName: optionalString(claims.given_name),
        familyName: optionalString(claims.family_name),
      };
    },
  },
  github: {
    name: 'github',
    issuer: GITHUB_ISSUER,
    // `user:email` is what lets /user/emails answer at all; the public profile
    // only carries an address the user chose to publish, unverified.
    scope: 'read:user user:email',
    usesIdToken: false,
    // GitHub publishes no discovery document for sign-in — its OIDC issuer is
    // for Actions workloads — so the endpoints are written out.
    configure: async () => {
      const { clientId, clientSecret } = credentials('github');
      return new client.Configuration(
        {
          issuer: GITHUB_ISSUER,
          authorization_endpoint: 'https://github.com/login/oauth/authorize',
          token_endpoint: 'https://github.com/login/oauth/access_token',
        },
        clientId,
        clientSecret,
      );
    },
    profile: async (tokens) => {
      const [user, emails] = await Promise.all([
        githubApi<GithubUser>('/user', tokens.access_token),
        githubApi<GithubEmail[]>('/user/emails', tokens.access_token),
      ]);
      return githubProfile(user, pickGithubEmail(emails));
    },
  },
};

/** Exported for the spec: everything about a GitHub profile but the fetch. */
export const githubProfile = (
  user: GithubUser,
  email: GithubEmail | undefined,
): ExternalProfile => {
  // GitHub has one free-text name, often absent and not always "first last".
  const [givenName, ...rest] = (user.name ?? '').trim().split(/\s+/);
  return {
    provider: GITHUB_ISSUER,
    sub: String(user.id),
    email: email?.email,
    emailVerified: email?.verified === true,
    givenName: optionalString(givenName),
    familyName: optionalString(rest.join(' ')),
    preferredUsername: optionalString(user.login),
  };
};

const isConfigured = (name: ProviderName): boolean => {
  const { clientId, clientSecret, redirectUri } = credentials(name);
  return Boolean(clientId && clientSecret && redirectUri);
};

/** A provider the caller named, if it exists *and* is configured. */
export const getProvider = (
  name: unknown,
): (ProviderDefinition & { redirectUri: string }) | undefined => {
  if (typeof name !== 'string' || !Object.hasOwn(PROVIDERS, name)) {
    return undefined;
  }
  const providerName = name as ProviderName;
  if (!isConfigured(providerName)) return undefined;
  return {
    ...PROVIDERS[providerName],
    redirectUri: credentials(providerName).redirectUri,
  };
};

export const enabledProviders = (): ProviderName[] =>
  (Object.keys(PROVIDERS) as ProviderName[]).filter(isConfigured);

/** Maps a stored identity's issuer back to the name the client knows. */
export const providerNameFor = (issuer: string): ProviderName | undefined =>
  Object.values(PROVIDERS).find((p) => p.issuer === issuer)?.name;

/**
 * The issuer stored for a provider name, configured or not — an identity
 * linked while a provider was enabled must stay removable after it is not.
 */
export const providerIssuer = (name: unknown): string | undefined =>
  typeof name === 'string' && Object.hasOwn(PROVIDERS, name)
    ? PROVIDERS[name as ProviderName].issuer
    : undefined;

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  google: 'Google',
  github: 'GitHub',
};

/**
 * What the password-gated actions answer for an account that has none.
 *
 * Such an account exists only because it was created through a provider. The
 * honest refusal was "That password is not correct", for a password the user
 * was never asked to choose — so they retried, and never learned that the way
 * forward is the emailed set-a-password link.
 */
export const PASSWORD_NOT_SET_MESSAGE =
  'This account signs in with Google or GitHub and has no password yet. Set one from Settings → Security first.';

const configurations = new Map<ProviderName, Promise<client.Configuration>>();

export const providerConfiguration = (
  provider: ProviderDefinition,
): Promise<client.Configuration> => {
  let pending = configurations.get(provider.name);
  if (!pending) {
    pending = provider.configure().catch((error) => {
      // Don't cache a failed discovery: Google being briefly unreachable must
      // not disable the button until the process restarts.
      configurations.delete(provider.name);
      throw error;
    });
    configurations.set(provider.name, pending);
  }
  return pending;
};

/**
 * The URL the provider sent the browser to, rebuilt on the configured
 * redirect URI.
 *
 * openid-client derives the `redirect_uri` it re-sends to the token endpoint by
 * stripping this URL's query, and providers refuse the exchange unless that is
 * exactly the URI the authorization request used. `req.originalUrl` is the path
 * as this process saw it — without any prefix a proxy strips — so only the
 * query is taken from the request.
 */
export const callbackUrl = (redirectUri: string, originalUrl: string): URL => {
  const url = new URL(redirectUri);
  url.search = new URL(originalUrl, url).search;
  return url;
};

// ─── Accounts ────────────────────────────────────────────────────────────────

const identityOf = (profile: ExternalProfile) => ({
  provider: profile.provider,
  sub: profile.sub,
});

const findByIdentity = (identity: { provider: string; sub: string }) =>
  User.findOne({ identities: { $elemMatch: identity } });

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

/** Clipped to the profile form's limits, so the user can still save it. */
const clip = (value: string | undefined, max: number): string | undefined =>
  value?.slice(0, max).trim() || undefined;

const freeUsername = async (seed: string): Promise<string> => {
  const base = seed
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 24)
    .padEnd(3, '0');
  for (let i = 0; i < 5; i++) {
    const candidate =
      i === 0 ? base : `${base}${crypto.randomInt(1000, 10000)}`;
    const taken = await User.exists({ username: candidate }).collation({
      locale: 'en',
      strength: 2,
    });
    if (!taken) return candidate;
  }
  return `${base}${crypto.randomBytes(3).toString('hex')}`; // ≤30 chars, within the 32 limit
};

export type LinkOutcome =
  | 'linked'
  | 'already_linked'
  /** The account already holds a *different* identity at this provider. */
  | 'provider_in_use'
  /** Another account owns this identity. */
  | 'identity_in_use';

/**
 * Attaches an identity to an account, at most one per provider.
 *
 * One per provider keeps "disconnect GitHub" meaning one thing. The filter and
 * the push are a single update, and the unique `identities_unique` index is
 * what settles two accounts racing for the same identity — a read-then-write
 * here would let both win.
 */
export const linkIdentity = async (
  userId: string,
  profile: ExternalProfile,
): Promise<LinkOutcome> => {
  const identity = identityOf(profile);
  try {
    // matchedCount, as in unlinkIdentity: the filter is the whole condition.
    const { matchedCount } = await User.updateOne(
      { _id: userId, 'identities.provider': { $ne: identity.provider } },
      { $push: { identities: identity } },
    );
    if (matchedCount === 1) return 'linked';
  } catch (error) {
    if (isDuplicateKey(error)) return 'identity_in_use';
    throw error;
  }

  const holdsIt = await User.exists({
    _id: userId,
    identities: { $elemMatch: identity },
  });
  return holdsIt ? 'already_linked' : 'provider_in_use';
};

/**
 * Detaches whatever identity the account holds at a provider.
 *
 * The presence test is in the filter, and the answer is `matchedCount`: the
 * schema keeps timestamps, so every update touches `updatedAt` and
 * `modifiedCount` is 1 even when the pull removed nothing.
 */
export const unlinkIdentity = async (
  userId: string,
  provider: string,
): Promise<boolean> => {
  const { matchedCount } = await User.updateOne(
    { _id: userId, 'identities.provider': provider },
    { $pull: { identities: { provider } } },
  );
  return matchedCount === 1;
};

export type ResolveError =
  | 'email_unverified'
  | 'link_required'
  | 'provider_in_use';

/**
 * The account a provider sign-in lands in.
 *
 * `linked` is true when this sign-in attached the provider to an account that
 * already existed — the one outcome the owner must be told about, because it
 * is also what a takeover through a provider would look like.
 */
export const resolveOidcUser = async (
  profile: ExternalProfile,
): Promise<{ user: IUser; linked: boolean } | { error: ResolveError }> => {
  const identity = identityOf(profile);

  const existing = await findByIdentity(identity);
  if (existing) return { user: existing, linked: false };

  if (!profile.emailVerified || !profile.email) {
    return { error: 'email_unverified' };
  }

  const email = normalizeEmail(profile.email);

  const local = await User.findOne({ email });
  if (local) {
    // An unverified local account may have been registered by someone who
    // merely typed this address; linking would hand it to them.
    if (!local.is_email_verified) return { error: 'link_required' };

    const outcome = await linkIdentity(local._id.toString(), profile);
    if (outcome === 'provider_in_use') return { error: 'provider_in_use' };
    if (outcome === 'identity_in_use') {
      // Lost a race with a parallel sign-in that linked it first.
      const owner = await findByIdentity(identity);
      if (owner) return { user: owner, linked: false };
    }
    return { user: local, linked: outcome === 'linked' };
  }

  const localPart = email.split('@')[0];
  try {
    const user = await User.create({
      email,
      first_name:
        clip(profile.givenName, 64) ??
        clip(profile.preferredUsername, 64) ??
        clip(localPart, 64),
      last_name: clip(profile.familyName, 64) ?? '-',
      username: await freeUsername(profile.preferredUsername ?? localPart),
      is_email_verified: true,
      identities: [identity],
    });
    return { user, linked: false };
  } catch (error) {
    // Two tabs finishing the same first sign-in: the loser finds the winner's
    // account rather than reporting a failure.
    if (isDuplicateKey(error)) {
      const owner = await findByIdentity(identity);
      if (owner) return { user: owner, linked: false };
    }
    throw error;
  }
};
