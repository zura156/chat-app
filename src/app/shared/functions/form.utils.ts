import { AbstractControl, FormGroup, ValidationErrors } from '@angular/forms';
import { apiFieldErrors } from './api-error';

export function markFormGroupTouched(formGroup: FormGroup): void {
  Object.values(formGroup.controls).forEach((control) => {
    control.markAsTouched();
    if (control instanceof FormGroup) markFormGroupTouched(control);
  });
}

/**
 * Turns Angular's validation error keys into the reason a person would give.
 *
 * Every form in this app answered an invalid submit with one constant string —
 * "Please fill in all fields correctly." — which names neither the field nor
 * the rule. On the sign-up form that covers six inputs and eleven validators,
 * so a user with a two-character username was told to check everything and
 * given no way to find out what was actually wrong. (Worse on that form: its
 * per-field messages were keyed on `minLength`/`maxLength`, and Angular's keys
 * are `minlength`/`maxlength`, so they could never render either.)
 */
const describeError = (key: string, detail: unknown): string | null => {
  const value = detail as Record<string, number> | true;

  switch (key) {
    case 'required':
      return 'is required';
    case 'email':
      return 'is not a valid email address';
    case 'minlength':
      return `must be at least ${(value as any)?.requiredLength} characters`;
    case 'maxlength':
      return `must be at most ${(value as any)?.requiredLength} characters`;
    case 'min':
      return `must be at least ${(value as any)?.min}`;
    case 'max':
      return `must be at most ${(value as any)?.max}`;
    case 'whitespace':
      return 'cannot be only spaces';
    case 'mustMatch':
      return 'does not match';
    case 'pattern':
      return 'contains characters that are not allowed';
    // Set by `applyServerFieldErrors`: the server's own wording, already a
    // complete reason, so it is passed through untouched.
    case 'server':
      return typeof detail === 'string' ? detail : null;
    // The password checklist is rendered in full by the forms that use it;
    // repeating its five clauses in a one-line summary would drown the others.
    case 'passwordStrength':
      return 'does not meet the password requirements';
    default:
      return null;
  }
};

/** Prefers the caller's label, then a readable form of the control name. */
const labelFor = (name: string, labels?: Record<string, string>): string =>
  labels?.[name] ??
  name.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());

const reasonsFor = (control: AbstractControl): string[] => {
  const errors: ValidationErrors = control.errors ?? {};
  return Object.entries(errors)
    .map(([key, detail]) => describeError(key, detail))
    .filter((reason): reason is string => reason !== null);
};

/**
 * One sentence per invalid control, naming the field and why it is invalid.
 *
 * `required` wins alone when present: telling someone their empty username
 * "is required and must be at least 3 characters" is two problems where there
 * is one.
 */
export function describeFormErrors(
  form: FormGroup,
  labels?: Record<string, string>,
): string[] {
  const described: string[] = [];

  for (const [name, control] of Object.entries(form.controls)) {
    if (control.valid) continue;

    const reasons = reasonsFor(control);
    if (reasons.length === 0) continue;

    const reason = reasons.includes('is required') ? 'is required' : reasons[0];
    described.push(`${labelFor(name, labels)} ${reason}.`);
  }

  // Group-level rules (password confirmation, for one) live on the form and
  // belong to no single control, so they would otherwise be invisible.
  for (const [key, detail] of Object.entries(form.errors ?? {})) {
    if (key === 'mustMatch') continue; // already reported on the control
    const reason = describeError(key, detail);
    if (reason) described.push(`This form ${reason}.`);
  }

  return described;
}

/**
 * `describeFormErrors` as a single line, for a form that has one error slot.
 *
 * Long lists are truncated rather than filling the screen — a user with five
 * empty fields is best served by fixing the first two and being told again.
 */
export function summarizeFormErrors(
  form: FormGroup,
  labels?: Record<string, string>,
  fallback = 'Please check the highlighted fields and try again.',
): string {
  const described = describeFormErrors(form, labels);
  if (described.length === 0) return fallback;
  if (described.length <= 3) return described.join(' ');

  return `${described.slice(0, 2).join(' ')} And ${
    described.length - 2
  } other fields need attention.`;
}

/**
 * Projects a 400 from the API back onto the controls it names.
 *
 * The server validates more than the form does — a username's character set, an
 * address already in use, a password on the breach list — so its refusals are
 * the only place some rules are ever stated. Without this they land in a banner
 * detached from the input that caused them, and the user is left comparing a
 * sentence against six fields.
 *
 * Returns the names it could place, so the caller can tell whether anything is
 * left for the banner to say.
 */
export function applyServerFieldErrors(
  form: FormGroup,
  error: unknown,
): string[] {
  const fields = apiFieldErrors(error);
  const placed: string[] = [];

  for (const [name, message] of Object.entries(fields)) {
    const control = form.get(name);
    if (!control) continue;

    // Merged, not replaced: a control can be both empty and refused by the
    // server, and dropping the client-side errors would let an invalid form
    // report itself as valid the moment the server error is cleared.
    control.setErrors({ ...(control.errors ?? {}), server: message });
    control.markAsTouched();
    placed.push(name);
  }

  return placed;
}

/**
 * Clears the errors `applyServerFieldErrors` set, leaving client-side ones.
 *
 * Called as the user edits: a server refusal describes the value that was
 * sent, so it stops being true the moment that value changes — and a stale one
 * would keep a corrected form unsubmittable with no way to clear it.
 */
export function clearServerFieldErrors(form: FormGroup): void {
  for (const control of Object.values(form.controls)) {
    if (!control.errors?.['server']) continue;

    const { server, ...rest } = control.errors;
    control.setErrors(Object.keys(rest).length > 0 ? rest : null);
  }
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
export function trimControls(form: FormGroup, names: readonly string[]): void {
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
