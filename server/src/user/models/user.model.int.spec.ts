import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeIntegration, resetDatabase } from '../../test/env';
import { User } from './user.model';

/*
 * The password hash is `select: false`, so it does not ride along on the dozen
 * reads that never needed it. That is a backstop rather than a fix for a known
 * leak — but backstops are exactly the thing that quietly stops working, and
 * the failure mode (a hash in a JSON response) is one you only notice from the
 * outside.
 *
 * These also pin the behaviour that made the change safe to begin with: an
 * existing document loaded *without* the path still saves, without tripping the
 * `required` validator and without blanking the stored hash. There are a dozen
 * `user.save()` calls that touch only other fields.
 */

const PASSWORD = 'Str0ng!Passw0rd';

describeIntegration('User model — password projection', () => {
  const makeUser = () =>
    User.create({
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      email: 'ada@example.test',
      password: PASSWORD,
    });

  beforeEach(resetDatabase);
  afterEach(resetDatabase);

  it('stores a bcrypt hash, never the plaintext', async () => {
    const user = await makeUser();
    expect(user.password).not.toBe(PASSWORD);
    expect(user.password).toMatch(/^\$2[aby]\$/);
  });

  it('omits the hash from an unprojected findById or findOne', async () => {
    const created = await makeUser();

    const byId = await User.findById(created._id);
    const byQuery = await User.findOne({ username: 'ada' });

    expect(byId!.password).toBeUndefined();
    expect(byQuery!.password).toBeUndefined();
  });

  it('omits the hash from a lean read', async () => {
    const created = await makeUser();
    const lean = await User.findById(created._id).lean();
    expect(lean!.password).toBeUndefined();
  });

  it('omits the hash from anything serialised to a response', async () => {
    // The actual failure this guards: `res.json(user)` on a document nobody
    // remembered to project.
    const created = await makeUser();
    const user = await User.findById(created._id);

    expect(JSON.stringify(user)).not.toContain('$2b$');
    expect(user!.toObject()).not.toHaveProperty('password');
  });

  it('hands the hash over when a query explicitly asks for it', async () => {
    const created = await makeUser();
    const user = await User.findById(created._id).select('+password');

    expect(user!.password).toMatch(/^\$2[aby]\$/);
    expect(await user!.comparePassword(PASSWORD)).toBe(true);
    expect(await user!.comparePassword('wrong')).toBe(false);
  });

  it('saves a document loaded without the hash, leaving it intact', async () => {
    // `required` and `isStrongPassword` are declared on the path. Mongoose
    // skips validators for paths that were not selected — this is the
    // behaviour every existing `user.save()` now depends on.
    const created = await makeUser();

    const partial = await User.findById(created._id);
    partial!.is_email_verified = true;
    await expect(partial!.save()).resolves.toBeDefined();

    const after = await User.findById(created._id).select('+password');
    expect(after!.is_email_verified).toBe(true);
    expect(await after!.comparePassword(PASSWORD)).toBe(true);
  });

  it('re-hashes when the password is actually changed', async () => {
    const created = await makeUser();
    const user = await User.findById(created._id).select('+password');
    const before = user!.password;

    user!.password = 'An0ther!Passw0rd';
    await user!.save();

    const after = await User.findById(created._id).select('+password');
    expect(after!.password).not.toBe(before);
    expect(after!.password).not.toBe('An0ther!Passw0rd');
    expect(await after!.comparePassword('An0ther!Passw0rd')).toBe(true);
    expect(await after!.comparePassword(PASSWORD)).toBe(false);
  });

  describe('the schema validator agrees with the shared policy', () => {
    /*
     * This was the third of the three disagreeing rules. It ran
     * `validator.isStrongPassword`, whose defaults demand a mixture of
     * character types from a symbol set matching neither the router's nor the
     * form's — so a password could satisfy both of those and still be refused
     * here, as a raw Mongoose ValidationError that reaches the client as a 500.
     *
     * It now delegates to `password-policy`, and these prove it: the model is
     * the floor no write path can bypass, and it must refuse and accept exactly
     * what the routes do.
     */

    const save = (password: string) =>
      User.create({
        first_name: 'Ada',
        last_name: 'Lovelace',
        username: `ada-${Math.random().toString(36).slice(2, 8)}`,
        email: `ada-${Math.random().toString(36).slice(2, 8)}@example.test`,
        password,
      });

    it.each([
      ['a short but "complex" password', 'P@ssw0rd!'],
      ['a keyboard walk', 'qwertyuiopasdfgh'],
      ['a repeated word', 'passwordpassword'],
      ['one repeated character', 'aaaaaaaaaaaaaaaaaaaa'],
    ])('refuses %s', async (_label, password) => {
      await expect(save(password)).rejects.toThrow();
    });

    it.each([
      ['a passphrase', 'correct-horse-tangerine-lamp'],
      ['a passphrase with spaces', 'anvil poppy quartz drift'],
      ['a passphrase with no uppercase', 'thunder plum vessel kite'],
      ['a passphrase in a non-Latin script', 'გამარჯობა მეგობარო როგორ ხარ'],
    ])('accepts %s', async (_label, password) => {
      await expect(save(password)).resolves.toBeDefined();
    });

    it('no longer demands a mixture of character types', async () => {
      // The specific thing `isStrongPassword` insisted on, and that NIST
      // SP 800-63B forbids requiring.
      await expect(save('thunder plum vessel kite orbit')).resolves.toBeDefined();
    });
  });

  it('does not re-hash an unchanged password on save', async () => {
    // The pre-save hook guards on isModified; without it every save would
    // hash the existing hash and lock the user out.
    const created = await makeUser();
    const user = await User.findById(created._id).select('+password');
    const before = user!.password;

    user!.bio = 'updated';
    await user!.save();

    const after = await User.findById(created._id).select('+password');
    expect(after!.password).toBe(before);
    expect(await after!.comparePassword(PASSWORD)).toBe(true);
  });
});
