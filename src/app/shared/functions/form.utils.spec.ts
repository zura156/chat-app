import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { markFormGroupTouched, trimControls } from './form.utils';

/*
 * Called from every submit handler that has to show validation on a form the
 * user tried to send without filling in. Angular only renders an error once a
 * control is touched, so a control this misses stays silently blank while the
 * submit does nothing — the "button is broken" bug.
 */

describe('markFormGroupTouched', () => {
  it('touches every control on the group', () => {
    const form = new FormGroup({
      email: new FormControl(''),
      password: new FormControl(''),
    });

    markFormGroupTouched(form);

    expect(form.controls.email.touched).toBe(true);
    expect(form.controls.password.touched).toBe(true);
  });

  it('descends into a nested group', () => {
    // The register form nests its password pair so the match validator has a
    // group to sit on; untouched children there are the usual symptom.
    const form = new FormGroup({
      name: new FormControl(''),
      passwords: new FormGroup({
        password: new FormControl(''),
        repeatPassword: new FormControl(''),
      }),
    });

    markFormGroupTouched(form);

    expect(form.controls.passwords.controls.password.touched).toBe(true);
    expect(form.controls.passwords.controls.repeatPassword.touched).toBe(true);
  });

  it('descends more than one level', () => {
    const inner = new FormControl('');
    const form = new FormGroup({
      a: new FormGroup({ b: new FormGroup({ c: inner }) }),
    });

    markFormGroupTouched(form);

    expect(inner.touched).toBe(true);
  });

  it('touches the nested group itself, not only its children', () => {
    const form = new FormGroup({
      passwords: new FormGroup({ password: new FormControl('') }),
    });

    markFormGroupTouched(form);

    expect(form.controls.passwords.touched).toBe(true);
  });

  it('leaves already-touched controls touched', () => {
    const form = new FormGroup({ email: new FormControl('') });
    form.controls.email.markAsTouched();

    markFormGroupTouched(form);

    expect(form.controls.email.touched).toBe(true);
  });

  it('does not change values, validity or dirtiness', () => {
    // It is called on submit, next to the request — touching a control must
    // not look like the user edited it.
    const form = new FormGroup({ email: new FormControl('a@b.c') });

    markFormGroupTouched(form);

    expect(form.controls.email.value).toBe('a@b.c');
    expect(form.controls.email.dirty).toBe(false);
    expect(form.valid).toBe(true);
  });

  it('handles an empty group', () => {
    expect(() => markFormGroupTouched(new FormGroup({}))).not.toThrow();
  });

  it('does not reach controls inside a FormArray', () => {
    /*
     * Pinned as a known gap, not as intended behaviour. The recursion tests
     * `instanceof FormGroup`, so a FormArray is marked touched itself while its
     * entries are not — errors on those rows stay hidden on submit.
     *
     * Nothing in the app currently submits a form with a FormArray, which is
     * why this has not bitten; the first one that does will hit it, and this
     * test is the warning.
     */
    const row = new FormControl('');
    const form = new FormGroup({ rows: new FormArray([row]) });

    markFormGroupTouched(form);

    expect(form.controls.rows.touched).toBe(true);
    expect(row.touched).toBe(false);
  });
});

/*
 * Called at the top of a submit handler, before validity is consulted, so that
 * whitespace never reaches the server and never decides a validator either.
 */
describe('trimControls', () => {
  it('trims the named control', () => {
    const form = new FormGroup({ email: new FormControl('  a@b.c  ') });

    trimControls(form, ['email']);

    expect(form.controls.email.value).toBe('a@b.c');
  });

  it('leaves controls it was not given', () => {
    /*
     * The whole reason controls are named rather than discovered. Trimming a
     * password changes the secret, and nothing on the server trims it back —
     * so an account created with a trailing space could never be signed into
     * again, and a correct password would be refused.
     */
    const form = new FormGroup({
      email: new FormControl('  a@b.c  '),
      password: new FormControl('  hunter2 '),
    });

    trimControls(form, ['email']);

    expect(form.controls.password.value).toBe('  hunter2 ');
  });

  it('revalidates against the trimmed value', () => {
    /*
     * The bug this exists for. `Validators.email` rejects an address with
     * spaces around it, so a pasted "  a@b.c " failed the form — the user was
     * told to fill the fields in correctly while looking at a correct address,
     * and no request was ever made for a later trim to clean up.
     */
    const form = new FormGroup({
      email: new FormControl('  a@b.c  ', [Validators.email]),
    });
    expect(form.valid).toBe(false);

    trimControls(form, ['email']);

    expect(form.valid).toBe(true);
  });

  it('makes a length rule count characters rather than spaces', () => {
    // "  ab  " satisfies a minimum of three that "ab" does not, and the server
    // trims before applying its own rules — so the value that got stored was
    // one this validator would have refused.
    const form = new FormGroup({
      first_name: new FormControl('  ab  ', [Validators.minLength(3)]),
    });
    expect(form.valid).toBe(true);

    trimControls(form, ['first_name']);

    expect(form.valid).toBe(false);
  });

  it('collapses a control holding only whitespace', () => {
    const form = new FormGroup({
      first_name: new FormControl('   ', [Validators.required]),
    });

    trimControls(form, ['first_name']);

    expect(form.controls.first_name.value).toBe('');
    expect(form.valid).toBe(false);
  });

  it('leaves a value that needed no trimming untouched', () => {
    // `setValue` emits, and a form nobody edited should not announce a change.
    const form = new FormGroup({ email: new FormControl('a@b.c') });
    let emissions = 0;
    form.controls.email.valueChanges.subscribe(() => emissions++);

    trimControls(form, ['email']);

    expect(emissions).toBe(0);
  });

  it('ignores a name that is not on the form', () => {
    const form = new FormGroup({ email: new FormControl('a@b.c') });

    expect(() => trimControls(form, ['nope'])).not.toThrow();
  });

  it('ignores a control whose value is not a string', () => {
    // Checkboxes and selects share submit handlers with text fields.
    const form = new FormGroup({
      remember: new FormControl(true),
      age: new FormControl(30),
      nothing: new FormControl(null),
    });

    trimControls(form, ['remember', 'age', 'nothing']);

    expect(form.controls.remember.value).toBe(true);
    expect(form.controls.age.value).toBe(30);
    expect(form.controls.nothing.value).toBeNull();
  });

  it('reaches a control inside a nested group', () => {
    // `form.get` takes a path, so the register form's shape is not a limit.
    const form = new FormGroup({
      contact: new FormGroup({ email: new FormControl('  a@b.c ') }),
    });

    trimControls(form, ['contact.email']);

    expect(form.controls.contact.controls.email.value).toBe('a@b.c');
  });
});
