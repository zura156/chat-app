import { FormControl, FormGroup, Validators } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { repeatPasswordValidator } from './repeat-password.validator';
import { passwordValidator } from './password.validator';

/*
 * Guards the "confirm password" field on register and reset-password.
 *
 * Unusual for a validator: it writes to another control. It calls
 * `setErrors` on the confirm field so the error renders under that field
 * rather than at the top of the form — which means it can also *erase* errors
 * that field owns. The early return for "the field already has a different
 * error" is the only thing keeping it from wiping the strength checklist, and
 * that guard is what most of this pins.
 */

const buildForm = (password: string, repeat: string) => {
  const form = new FormGroup(
    {
      password: new FormControl(password),
      repeatPassword: new FormControl(repeat),
    },
    { validators: repeatPasswordValidator('password', 'repeatPassword') },
  );
  form.updateValueAndValidity();
  return form;
};

describe('repeatPasswordValidator', () => {
  it('passes when the two fields agree', () => {
    const form = buildForm('Passw0rd!', 'Passw0rd!');

    expect(form.errors).toBeNull();
    expect(form.controls.repeatPassword.errors).toBeNull();
  });

  it('reports a mismatch on the group and on the confirm field', () => {
    // Both: the group error drives the submit button, the control error is
    // what renders the message under the field.
    const form = buildForm('Passw0rd!', 'Passw0rd');

    expect(form.errors).toEqual({ mustMatch: true });
    expect(form.controls.repeatPassword.errors).toEqual({ mustMatch: true });
  });

  it('does not put the error on the first field', () => {
    // The user is being told their *confirmation* is wrong, not their password.
    const form = buildForm('Passw0rd!', 'Passw0rd');
    expect(form.controls.password.errors).toBeNull();
  });

  it('clears the mismatch once the user corrects the confirmation', () => {
    const form = buildForm('Passw0rd!', 'Passw0r');
    expect(form.controls.repeatPassword.errors).toEqual({ mustMatch: true });

    form.controls.repeatPassword.setValue('Passw0rd!');

    expect(form.errors).toBeNull();
    expect(form.controls.repeatPassword.errors).toBeNull();
  });

  it('follows an edit to the first field, not just the second', () => {
    // Changing the password after confirming it is the case a naive
    // implementation misses — the pair now disagrees but the confirm field was
    // never touched again.
    const form = buildForm('Passw0rd!', 'Passw0rd!');
    form.controls.password.setValue('Different1!');

    expect(form.errors).toEqual({ mustMatch: true });
  });

  it('is case sensitive', () => {
    expect(buildForm('Passw0rd!', 'passw0rd!').errors).toEqual({
      mustMatch: true,
    });
  });

  it('treats trailing whitespace as a mismatch', () => {
    // A trailing space is a real character in a password; silently accepting
    // it here would let the user register one they cannot then type back.
    expect(buildForm('Passw0rd!', 'Passw0rd! ').errors).toEqual({
      mustMatch: true,
    });
  });

  it('passes while both fields are still empty', () => {
    // Two empty strings agree. Emptiness is Validators.required's job — this
    // must not light the form up before anything is typed.
    expect(buildForm('', '').errors).toBeNull();
  });

  it('leaves an error the confirm field owns alone', () => {
    /*
     * This is the guard the whole validator hinges on. The confirm field
     * carries `required` here; without the early return the `setErrors(null)`
     * on the matching branch would clear it, and an empty confirmation would
     * submit.
     */
    const form = new FormGroup(
      {
        password: new FormControl(''),
        repeatPassword: new FormControl('', Validators.required),
      },
      { validators: repeatPasswordValidator('password', 'repeatPassword') },
    );
    form.updateValueAndValidity();

    expect(form.controls.repeatPassword.errors).toEqual({ required: true });
    expect(form.errors).toBeNull();
  });

  it('defers to the strength checklist rather than replacing it', () => {
    // The confirm field on the reset form carries the same strength validator
    // as the password field. Reporting "must match" over the top of an unmet
    // strength rule would swap a specific message for a vaguer one.
    const form = new FormGroup(
      {
        password: new FormControl('a-quiet-tuesday-afternoon'),
        repeatPassword: new FormControl('abc', passwordValidator()),
      },
      { validators: repeatPasswordValidator('password', 'repeatPassword') },
    );
    form.updateValueAndValidity();

    expect(form.controls.repeatPassword.errors).toHaveProperty(
      'passwordStrength',
    );
    expect(form.controls.repeatPassword.errors).not.toHaveProperty('mustMatch');
  });

  it('reports the mismatch once its own error is the only one left', () => {
    // Continuation of the case above: the user fixes the strength problem, and
    // the mismatch — previously suppressed — now has to appear.
    const form = new FormGroup(
      {
        password: new FormControl('a-quiet-tuesday-afternoon'),
        repeatPassword: new FormControl('abc', passwordValidator()),
      },
      { validators: repeatPasswordValidator('password', 'repeatPassword') },
    );
    form.updateValueAndValidity();

    form.controls.repeatPassword.setValue('purple-monkey-dishwasher');

    expect(form.controls.repeatPassword.errors).toEqual({ mustMatch: true });
    expect(form.errors).toEqual({ mustMatch: true });
  });

  it('does nothing when a control name does not exist', () => {
    // A rename that misses the validator call would otherwise throw on every
    // keystroke; passing silently is the safer failure, but it also means the
    // check is quietly gone.
    const form = new FormGroup(
      {
        password: new FormControl('a'),
        repeatPassword: new FormControl('b'),
      },
      { validators: repeatPasswordValidator('password', 'confirmPassword') },
    );
    form.updateValueAndValidity();

    expect(form.errors).toBeNull();
    expect(form.controls.repeatPassword.errors).toBeNull();
  });
});
