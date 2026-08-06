/**
 * The factors an account can be challenged with.
 *
 * Lives under auth rather than in the settings feature because both ends need
 * it: settings enrols a factor, the login screen answers one, and a string
 * union duplicated in two places is exactly the kind of thing that drifts into
 * a client asking for `'email'` while the other half checks for `'mail'`.
 */
export type TwoFactorMethod = 'totp' | 'email';

/** What the password step returns when it is not enough on its own. */
export interface TwoFactorChallengeI {
  two_factor_required: true;
  methods: TwoFactorMethod[];
  default_method: TwoFactorMethod;
}
