import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeIntegration, resetDatabase } from '../../env';
import { User } from '../../../user/models/user.model';
import {
  ExternalProfile,
  linkIdentity,
  resolveOidcUser,
  unlinkIdentity,
} from '../../../auth/services/oidc.service';

/*
 * Which account a Google or GitHub sign-in lands in, against a real database.
 *
 * Real because the guarantees are the database's: one owner per identity is
 * the `identities_unique` index, not a check in code, and "one identity per
 * provider per account" is a filtered update. A mock would assert that the
 * code asked nicely, not that a second owner is actually refused.
 */

const GOOGLE = 'https://accounts.google.com';
const GITHUB = 'https://github.com';

const google = (overrides: Partial<ExternalProfile> = {}): ExternalProfile => ({
  provider: GOOGLE,
  sub: 'google-sub-1',
  email: 'ada@example.test',
  emailVerified: true,
  givenName: 'Ada',
  familyName: 'Lovelace',
  ...overrides,
});

const github = (overrides: Partial<ExternalProfile> = {}): ExternalProfile => ({
  provider: GITHUB,
  sub: '42',
  email: 'ada@example.test',
  emailVerified: true,
  preferredUsername: 'ada-l',
  ...overrides,
});

const makeLocal = (overrides: Record<string, unknown> = {}) =>
  User.create({
    first_name: 'Ada',
    last_name: 'Lovelace',
    username: 'ada',
    email: 'ada@example.test',
    password: 'Str0ng!Passw0rd',
    is_email_verified: true,
    ...overrides,
  });

// `+password` alone: naming another path too would make it an inclusive
// projection and drop every field the assertions read.
const reload = (id: unknown) => User.findById(id).select('+password').lean();

describeIntegration('provider accounts', () => {
  beforeAll(async () => {
    // The unique identity index is what the race and ownership tests are
    // about; make sure it exists before the first one runs.
    await User.init();
  });

  beforeEach(resetDatabase);

  describe('resolveOidcUser', () => {
    it('creates a verified account with no password on a first sign-in', async () => {
      const result = await resolveOidcUser(google());
      if ('error' in result) throw new Error(result.error);

      expect(result.linked).toBe(false);
      const stored = await reload(result.user._id);
      expect(stored?.password).toBeUndefined();
      expect(stored?.is_email_verified).toBe(true);
      expect(stored?.first_name).toBe('Ada');
      expect(stored?.identities).toEqual([
        { provider: GOOGLE, sub: 'google-sub-1' },
      ]);
    });

    it('signs the same identity into the same account every time', async () => {
      const first = await resolveOidcUser(google());
      const second = await resolveOidcUser(google({ email: 'changed@example.test' }));
      if ('error' in first || 'error' in second) throw new Error('refused');

      expect(String(second.user._id)).toBe(String(first.user._id));
      expect(await User.countDocuments()).toBe(1);
    });

    it('refuses an address the provider has not verified', async () => {
      expect(await resolveOidcUser(google({ emailVerified: false }))).toEqual({
        error: 'email_unverified',
      });
      expect(await User.countDocuments()).toBe(0);
    });

    it('links to a verified local account, and says it did', async () => {
      const local = await makeLocal();

      const result = await resolveOidcUser(google());
      if ('error' in result) throw new Error(result.error);

      expect(String(result.user._id)).toBe(String(local._id));
      expect(result.linked).toBe(true);
      expect((await reload(local._id))?.identities).toHaveLength(1);
    });

    // Someone may have registered it by typing an address they do not own.
    it('refuses to link a local account whose address is unverified', async () => {
      const local = await makeLocal({ is_email_verified: false });

      expect(await resolveOidcUser(google())).toEqual({
        error: 'link_required',
      });
      expect((await reload(local._id))?.identities).toEqual([]);
    });

    it('refuses a second account at a provider the account already uses', async () => {
      await makeLocal({ identities: [{ provider: GOOGLE, sub: 'google-sub-1' }] });

      expect(await resolveOidcUser(google({ sub: 'google-sub-2' }))).toEqual({
        error: 'provider_in_use',
      });
    });

    it('finds a free username when the natural one is taken in any case', async () => {
      await makeLocal({ username: 'ADA-L', email: 'someone@example.test' });

      const result = await resolveOidcUser(github());
      if ('error' in result) throw new Error(result.error);

      expect(result.user.username).toMatch(/^ada-l\d{4}$/);
    });

    // Required by the schema: an empty name used to fail every such sign-in.
    it('names a GitHub account that has no display name after its login', async () => {
      const result = await resolveOidcUser(github());
      if ('error' in result) throw new Error(result.error);

      expect(result.user.first_name).toBe('ada-l');
      expect(result.user.last_name).toBe('-');
    });

    it('gives an account with no password nothing a password can match', async () => {
      const result = await resolveOidcUser(google());
      if ('error' in result) throw new Error(result.error);

      const user = await User.findById(result.user._id).select('+password');
      expect(await user!.comparePassword('')).toBe(false);
      expect(await user!.comparePassword('Str0ng!Passw0rd')).toBe(false);
    });
  });

  describe('linkIdentity / unlinkIdentity', () => {
    it('attaches once, and reports a repeat as already linked', async () => {
      const local = await makeLocal();

      expect(await linkIdentity(String(local._id), github())).toBe('linked');
      expect(await linkIdentity(String(local._id), github())).toBe(
        'already_linked',
      );
      expect((await reload(local._id))?.identities).toHaveLength(1);
    });

    it('refuses an identity another account owns', async () => {
      const owner = await makeLocal();
      const other = await makeLocal({
        username: 'grace',
        email: 'grace@example.test',
      });

      expect(await linkIdentity(String(owner._id), github())).toBe('linked');
      expect(await linkIdentity(String(other._id), github())).toBe(
        'identity_in_use',
      );
      expect((await reload(other._id))?.identities).toEqual([]);
    });

    it('refuses a second identity at a provider already connected', async () => {
      const local = await makeLocal();

      await linkIdentity(String(local._id), github());
      expect(await linkIdentity(String(local._id), github({ sub: '43' }))).toBe(
        'provider_in_use',
      );
    });

    it('detaches, and reports whether there was anything to detach', async () => {
      const local = await makeLocal();
      await linkIdentity(String(local._id), github());
      await linkIdentity(String(local._id), google());

      expect(await unlinkIdentity(String(local._id), GITHUB)).toBe(true);
      expect(await unlinkIdentity(String(local._id), GITHUB)).toBe(false);
      expect((await reload(local._id))?.identities).toEqual([
        { provider: GOOGLE, sub: 'google-sub-1' },
      ]);
    });
  });
});
