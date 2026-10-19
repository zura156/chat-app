import { Configuration, discovery, IDToken } from 'openid-client';
import config from '../../config/config';
import { User } from '../../user/models/user.model';
import { normalizeEmail } from './auth.service';
import crypto from 'crypto';

let cfg: Promise<Configuration> | undefined;

const freeUsername = async (email: string): Promise<string> => {
  const base = email
    .split('@')[0]
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
  return `${base}${crypto.randomBytes(3).toString('hex')}`; // ≤30 chars, within your 32 limit
};

export const oidcConfig = () =>
  (cfg ??= discovery(
    new URL(config.oidc.issuer),
    config.oidc.clientId,
    config.oidc.clientSecret,
  ).catch((e) => {
    cfg = undefined;
    throw e;
  })); // don't cache a failed discovery

export const resolveOidcUser = async (claims: IDToken) => {
  const identity = { provider: config.oidc.issuer, sub: claims.sub };

  const linked = await User.findOne({
    'identities.sub': claims.sub,
    identities: { $elemMatch: identity },
  });

  if (linked) return { user: linked };

  if (claims.email_verified !== true || typeof claims.email !== 'string')
    return { error: 'email_unverified' } as const;

  const email = normalizeEmail(claims.email);

  const local = await User.findOne({ email });
  if (local) {
    if (!local.is_email_verified) return { error: 'link_required' } as const;

    local.identities.push(identity);
    await local.save();
    return { user: local };
  }

  const user = await User.create({
    email,
    first_name: String(claims.given_name ?? claims.name ?? '').trim(),
    last_name: String(claims.family_name ?? '-').trim(),
    username: await freeUsername(email),
    is_email_verified: true,
    identities: [identity],
  });
  return { user };
};
