import { FormGroup } from '@angular/forms';

export function markFormGroupTouched(formGroup: FormGroup): void {
  Object.values(formGroup.controls).forEach((control) => {
    control.markAsTouched();
    if (control instanceof FormGroup) markFormGroupTouched(control);
  });
}
