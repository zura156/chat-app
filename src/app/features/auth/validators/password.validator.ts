import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const passwordValidator = (): ValidatorFn => {
  return (control: AbstractControl): ValidationErrors | null => {
    if (!control.value) {
      return null;
    }

    const hasLength = control.value.length >= 8;
    const hasUppercase = /[A-Z]/.test(control.value);
    const hasNumeric = /[0-9]/.test(control.value);
    const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(control.value);

    const isValid = hasLength && hasUppercase && hasNumeric && hasSpecial;

    if (!isValid) {
      return {
        passwordStrength: {
          hasLength: hasLength,
          hasUppercase: hasUppercase,
          hasNumeric: hasNumeric,
          hasSpecial: hasSpecial,
        },
      };
    }

    return null;
  };
};
