import { Component, inject, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { remixGithubFill, remixGoogleFill } from '@ng-icons/remixicon';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { AuthService, OidcProvider } from '../../services/auth.service';
import {
  OIDC_PROVIDER_DETAILS,
  injectEnabledOidcProviders,
} from '../../services/oidc-providers';

/**
 * "Continue with Google / GitHub", for the login and register pages. Renders
 * only the providers the server is configured for — see
 * `injectEnabledOidcProviders`.
 */
@Component({
  selector: 'app-oidc-buttons',
  imports: [HlmButton, NgIcon, HlmFieldImports],
  providers: [provideIcons({ remixGithubFill, remixGoogleFill })],
  template: `
    @if (providers().length) {
      <div class="mb-2">
        <hlm-field-separator>Or continue with</hlm-field-separator>
      </div>

      @for (provider of providers(); track provider) {
        <hlm-field>
          <button
            hlmBtn
            variant="outline"
            type="button"
            class="w-full cursor-pointer rounded-full"
            [disabled]="leaving()"
            (click)="continueWith(provider)"
          >
            <ng-icon
              [name]="details[provider].icon"
              class="text-xl"
              aria-hidden="true"
            />
            {{ verb() }} with {{ details[provider].label }}
          </button>
        </hlm-field>
      }
    }
  `,
})
export class OidcButtonsComponent {
  private authService = inject(AuthService);

  /** "Continue" on the login page, "Sign up" on the register page. */
  verb = input('Continue');

  protected readonly details = OIDC_PROVIDER_DETAILS;
  protected readonly providers = injectEnabledOidcProviders();

  /** The page is about to unload; a second click would only race it. */
  protected readonly leaving = signal(false);

  protected continueWith(provider: OidcProvider): void {
    this.leaving.set(true);
    this.authService.startOidc(provider);
  }
}
