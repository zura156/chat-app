import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function noOnlyWhitespace(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null =>
    control.value?.trim().length === 0 ? { whitespace: true } : null;
}
