import { FormGroup } from '@angular/forms';

export function markFormGroupTouched(formGroup: FormGroup): void {
  Object.values(formGroup.controls).forEach((control) => {
    control.markAsTouched();
    if (control instanceof FormGroup) markFormGroupTouched(control);
  });
}

/**
 * Trims the named controls in place, and re-runs their validators.
 *
 * Called at the *top* of a submit handler, before validity is consulted.
 * Trimming further down — where the payload is assembled — is too late to
 * matter and mostly does nothing:
 *
 *   - `Validators.email` refuses an address with spaces around it, so a pasted
 *     "  ada@example.test " failed the form outright. The user is told to fill
 *     the fields in correctly while looking at an address that is correct, and
 *     no request is ever made for the later trim to clean up.
 *   - `Validators.minLength` counts the spaces, so "  ab  " satisfies a minimum
 *     of three characters that "ab" does not. The server trims before applying
 *     its own rules, so the value that gets stored is one the client's own
 *     validator would have rejected.
 *
 * Controls are named rather than discovered, so that a password can never be
 * swept up by accident: trimming one changes the secret, and nothing on the
 * server trims it back.
 */
export function trimControls(
  form: FormGroup,
  names: readonly string[],
): void {
  for (const name of names) {
    const control = form.get(name);
    const value = control?.value;
    if (typeof value !== 'string') continue;

    const trimmed = value.trim();
    // Guarded because `setValue` emits, and an untouched form should not
    // announce a change that did not happen.
    if (trimmed !== value) control!.setValue(trimmed);
  }
}
