import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { noOnlyWhitespace } from './no-only-whitespace.validator';

/*
 * Stops a message, group name or bio that is nothing but spaces.
 *
 * The case that matters is the message composer: a run of spaces makes the
 * send button look enabled and produces a bubble with no visible content, which
 * cannot be told apart from a failed render. It is a *client-side* check only —
 * the API has its own — so its job is to keep the button disabled.
 */

const validate = (value: unknown) =>
  noOnlyWhitespace()(new FormControl(value));

describe('noOnlyWhitespace', () => {
  it('accepts text', () => {
    expect(validate('hello')).toBeNull();
  });

  it('rejects a value made only of spaces', () => {
    expect(validate(' ')).toEqual({ whitespace: true });
    expect(validate('     ')).toEqual({ whitespace: true });
  });

  it('rejects tabs and newlines too', () => {
    // The composer is a textarea, so Enter-without-send and pasted indentation
    // both land here.
    expect(validate('\t')).toEqual({ whitespace: true });
    expect(validate('\n\n')).toEqual({ whitespace: true });
    expect(validate(' \t\n ')).toEqual({ whitespace: true });
  });

  it('accepts text with whitespace around it', () => {
    // Only *entirely* blank is refused — leading and trailing space is the
    // server's to trim, and refusing it mid-typing is hostile.
    expect(validate('  hello  ')).toBeNull();
    expect(validate('\n hi \n')).toBeNull();
  });

  it('accepts a single visible character', () => {
    expect(validate('a')).toBeNull();
    expect(validate('?')).toBeNull();
  });

  it('accepts an emoji-only message', () => {
    // A common legitimate message, and its trimmed length is not 0.
    expect(validate('👍')).toBeNull();
  });

  it('also rejects the empty string', () => {
    /*
     * Worth knowing rather than assuming: '' trims to length 0, so this fires
     * alongside `Validators.required` rather than deferring to it. Both errors
     * land on the control at once. Harmless where the template renders a
     * single message, but a template that renders per-error shows two.
     */
    expect(validate('')).toEqual({ whitespace: true });
  });

  it('ignores a control with no value at all', () => {
    // Optional fields (bio) are null until edited; flagging those would make a
    // settings form invalid on open.
    expect(validate(null)).toBeNull();
    expect(validate(undefined)).toBeNull();
  });

  it('throws on a non-string value', () => {
    /*
     * Pinned as a limitation. `value?.trim()` guards null but not type — a
     * numeric or Date control reaches `.trim` and throws inside change
     * detection, which surfaces as a form that stops updating rather than as
     * an obvious error. Every current use is on a text control.
     */
    expect(() => validate(42)).toThrow(TypeError);
    expect(() => validate(new Date())).toThrow(TypeError);
  });
});
