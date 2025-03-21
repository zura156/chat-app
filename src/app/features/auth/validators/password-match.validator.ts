import { AbstractControl, ValidatorFn } from '@angular/forms';

export const matchPassword: ValidatorFn = (
  control: AbstractControl
) => {
  let password = control.get('password') ?? control.get('newPassword');
  let repeatPassword = control.get('repeat_password');

  if (password && repeatPassword && password.value === repeatPassword.value) {
    return {
      passwordMatch: true,
    };
  }

  return null;
};
