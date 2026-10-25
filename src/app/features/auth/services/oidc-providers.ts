import { Signal, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import type { OidcProvider } from './auth.service';

/** How each provider is named and drawn. Icons come from @ng-icons/remixicon. */
export const OIDC_PROVIDER_DETAILS: Record<
  OidcProvider,
  { label: string; icon: string }
> = {
  google: { label: 'Google', icon: 'remixGoogleFill' },
  github: { label: 'GitHub', icon: 'remixGithubFill' },
};

export const isOidcProvider = (name: unknown): name is OidcProvider =>
  typeof name === 'string' && Object.hasOwn(OIDC_PROVIDER_DETAILS, name);

/**
 * The providers the server has credentials for. Must be called in an
 * injection context (a field initialiser).
 *
 * Asked of the server rather than set in the environment file: enabling a
 * provider is deciding to hold its client secret, which is a server-side act,
 * and a client list that drifted from it would render buttons that always
 * fail. Anything listed that this build has no details for is dropped; on an
 * error the list is empty and no buttons render.
 */
export const injectEnabledOidcProviders = (): Signal<OidcProvider[]> => {
  const resource = httpResource<{ providers: unknown[] }>(
    () => `${environment.apiUrl}/auth/oidc/providers`,
  );
  return computed(() =>
    resource.hasValue() ? resource.value().providers.filter(isOidcProvider) : [],
  );
};
