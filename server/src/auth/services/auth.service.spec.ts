import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './auth.service';

/*
 * Every path that looks a user up by email has to agree about what the address
 * *is*, or they disagree about who it belongs to. That is not hypothetical:
 * login ran express-validator's `normalizeEmail()` (which strips dots and the
 * +tag for Gmail) while forgot-password only lowercased, so a user who signed
 * up as `Foo.Bar@gmail.com` could log in but could never receive a reset mail —
 * and the endpoint's deliberately vague "sent if it exists" response hid it.
 */

describe('normalizeEmail', () => {
  it('lowercases, so case cannot fork one account into two', () => {
    expect(normalizeEmail('Foo@Example.COM')).toBe('foo@example.com');
  });

  it('trims surrounding whitespace, which is what pasting adds', () => {
    expect(normalizeEmail('  foo@example.com \n')).toBe('foo@example.com');
  });

  it('keeps dots and +tags — they are different mailboxes at most providers', () => {
    // The conservative choice, deliberately: silently merging `foo.bar@` and
    // `foobar@` is its own bug, and it is not reversible once accounts exist.
    expect(normalizeEmail('Foo.Bar+news@gmail.com')).toBe(
      'foo.bar+news@gmail.com',
    );
  });

  it('is idempotent', () => {
    const once = normalizeEmail('  Foo.Bar@Example.com ');
    expect(normalizeEmail(once)).toBe(once);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 12345],
  ])('never throws on %s', (_label, raw) => {
    // Reached straight from `req.body.email` on unauthenticated routes, so a
    // throw here is a 500 handed to anyone who posts a non-string.
    expect(() => normalizeEmail(raw as unknown as string)).not.toThrow();
  });

  it('turns a missing address into an empty string, not "undefined"', () => {
    // The rate limiters key on this. `String(undefined)` would produce the
    // literal key "undefined", pooling every anonymous caller into one bucket.
    expect(normalizeEmail(undefined as unknown as string)).toBe('');
    expect(normalizeEmail(null as unknown as string)).toBe('');
  });
});
