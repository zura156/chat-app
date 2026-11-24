import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEGAL } from '../../../legal/legal.config';

/**
 * The agreement line under the sign-up and sign-in forms.
 *
 * It sits on the login page too, not only on register: "Continue with Google"
 * there creates an account when none matches, so the login page is an
 * account-creation path and needs the same notice. The links open a new tab
 * so following one does not throw away a half-filled form.
 *
 * This is notice, not a record. The server does not yet store which version
 * of the terms an account accepted, or when.
 */
@Component({
  selector: 'app-legal-notice',
  imports: [RouterLink],
  template: `
    <p
      class="text-center text-xs leading-relaxed text-muted-foreground text-balance"
    >
      By {{ action() }}, you agree to our
      <a
        routerLink="/legal/terms"
        target="_blank"
        class="text-foreground underline underline-offset-2 hover:text-muted-foreground"
        >Terms of Use</a
      >
      and confirm you are at least {{ minimumAge }}. Our
      <a
        routerLink="/legal/privacy"
        target="_blank"
        class="text-foreground underline underline-offset-2 hover:text-muted-foreground"
        >Privacy Policy</a
      >
      explains how we use your data.
    </p>
  `,
})
export class LegalNoticeComponent {
  /** Completes "By …, you agree": "creating an account", "continuing". */
  readonly action = input('continuing');

  protected readonly minimumAge = LEGAL.minimumAge;
}
