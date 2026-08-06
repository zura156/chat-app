import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { markFormGroupTouched } from './form.utils';

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
