import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecuritySettings } from './security-settings';
import {
  SecuritySettingsService,
  TwoFactorConfirmI,
  TwoFactorStatusI,
} from '../../../services/security-settings.service';
import { AuthService } from '../../../../auth/services/auth.service';

/*
 * The enrolment wizard, now that an account can hold two factors at once.
 *
 * The behaviours worth pinning are the ones where "two factors" changes an
 * answer that used to be obvious with one:
 *
 *   - recovery codes are minted for the *first* factor and left alone for the
 *     second, so the wizard must not present an empty array as "here are your
 *     codes";
 *   - turning one factor off leaves the other and keeps the session, so the
 *     screen must not bounce to the login page on every removal;
 *   - the password is sent exactly as typed. It used to be `.trim()`ed, which
 *     silently broke any password with a leading or trailing space — the server
 *     compares against the hash of the real one, so those accounts were told
 *     their own password was wrong.
 */

const status = (over: Partial<TwoFactorStatusI> = {}): TwoFactorStatusI => ({
  enabled: false,
  methods: [],
  totp_enabled: false,
  email_enabled: false,
  totp_pending: false,
  recovery_codes_remaining: 0,
  ...over,
});

/**
 * Annotated, so `recovery_codes: []` in a default does not narrow the mock's
 * return type to `never[]` and reject the populated array a later test needs.
 */
const confirmed = (
  over: Partial<TwoFactorConfirmI> = {},
): TwoFactorConfirmI => ({ ...status(), recovery_codes: [], ...over });

const removed = (
  over: Partial<TwoFactorStatusI & { signedOut: boolean }> = {},
): TwoFactorStatusI & { signedOut: boolean } => ({
  ...status(),
  signedOut: true,
  ...over,
});

const twoFactor = signal<TwoFactorStatusI>(status());

const security = {
  sessions: signal([]),
  twoFactor,
  loading: signal(false),
  load: vi.fn(() => of({ sessions: [] })),
  loadTwoFactor: vi.fn(() => of(status())),
  revokeSession: vi.fn(() => of({})),
  revokeAllSessions: vi.fn(() => of({})),
  changePassword: vi.fn(() => of({ message: 'ok', signed_out_sessions: 0 })),
  beginTwoFactorSetup: vi.fn(() =>
    of({ secret: 'ABC', otpauth_uri: 'otpauth://totp/x', expires_at: '' }),
  ),
  confirmTwoFactorSetup: vi.fn(() =>
    of(confirmed({ enabled: true, totp_enabled: true })),
  ),
  beginEmailTwoFactorSetup: vi.fn(() =>
    of({ sent_to: 'someone@example.test', expires_in_seconds: 600 }),
  ),
  confirmEmailTwoFactorSetup: vi.fn(() =>
    of(confirmed({ enabled: true, email_enabled: true })),
  ),
  sendEmailTwoFactorChallenge: vi.fn(() =>
    of({ sent_to: 'someone@example.test', expires_in_seconds: 600 }),
  ),
  disableTwoFactor: vi.fn(() => of(removed())),
  describeDevice: () => 'Browser on Linux',
  isMobile: () => false,
};

const authService = {
  user: signal({ email: 'someone@example.test' }),
  handleAuthFailure: vi.fn(),
};

const build = async (): Promise<ComponentFixture<SecuritySettings>> => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [SecuritySettings],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: SecuritySettingsService, useValue: security },
      { provide: AuthService, useValue: authService },
    ],
  });

  const fixture = TestBed.createComponent(SecuritySettings);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
};

describe('SecuritySettings — two factors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    twoFactor.set(status());
  });

  describe('enrolling', () => {
    it('asks for the password before either factor', async () => {
      const fixture = await build();

      fixture.componentInstance.beginSetup('email');
      expect(fixture.componentInstance.setupStage()).toBe(
        'confirming-password',
      );
      expect(fixture.componentInstance.setupMethod()).toBe('email');
    });

    it('sends the password exactly as typed', async () => {
      const fixture = await build();
      fixture.componentInstance.beginSetup('totp');

      // The regression: `.trim()` here made a password with a trailing space
      // unusable, and the error said the password was wrong.
      fixture.componentInstance.password.set('  spaced password  ');
      fixture.componentInstance.startTwoFactorSetup();

      expect(security.beginTwoFactorSetup).toHaveBeenCalledWith(
        '  spaced password  ',
      );
    });

    it('routes an email enrolment to the email endpoint', async () => {
      const fixture = await build();
      fixture.componentInstance.beginSetup('email');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.startTwoFactorSetup();
      await fixture.whenStable();

      expect(security.beginEmailTwoFactorSetup).toHaveBeenCalledWith('pw');
      expect(security.beginTwoFactorSetup).not.toHaveBeenCalled();
      expect(fixture.componentInstance.setupStage()).toBe(
        'awaiting-email-code',
      );
      expect(fixture.componentInstance.emailSentTo()).toBe(
        'someone@example.test',
      );
    });

    it('shows the QR step for an authenticator enrolment', async () => {
      const fixture = await build();
      fixture.componentInstance.beginSetup('totp');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.startTwoFactorSetup();
      await fixture.whenStable();

      expect(fixture.componentInstance.setupStage()).toBe('scanning');
      expect(fixture.componentInstance.setupSecret()).toBe('ABC');
    });

    it('clears the password out of memory once it has been spent', async () => {
      const fixture = await build();
      fixture.componentInstance.beginSetup('totp');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.startTwoFactorSetup();
      await fixture.whenStable();

      expect(fixture.componentInstance.password()).toBe('');
    });

    it('shows recovery codes when the first factor mints them', async () => {
      const fixture = await build();
      fixture.componentInstance.beginSetup('totp');
      fixture.componentInstance.setupStage.set('scanning');
      fixture.componentInstance.code.set('123456');

      security.confirmTwoFactorSetup.mockReturnValueOnce(
        of(
          confirmed({
            enabled: true,
            totp_enabled: true,
            recovery_codes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'],
          }),
        ),
      );
      fixture.componentInstance.confirmTwoFactorSetup();
      await fixture.whenStable();

      expect(fixture.componentInstance.setupStage()).toBe('recovery');
      expect(fixture.componentInstance.recoveryCodes()).toHaveLength(2);
    });

    it('closes quietly when a second factor reuses the existing codes', async () => {
      const fixture = await build();
      fixture.componentInstance.beginSetup('email');
      fixture.componentInstance.setupStage.set('awaiting-email-code');
      fixture.componentInstance.code.set('123456');

      // An empty array means "you already have codes", not "here are none".
      // Rendering the recovery screen on it would show an empty grid under
      // "This is the only time they are shown".
      fixture.componentInstance.confirmTwoFactorSetup();
      await fixture.whenStable();

      expect(security.confirmEmailTwoFactorSetup).toHaveBeenCalledWith('123456');
      expect(fixture.componentInstance.setupStage()).toBe('idle');
      expect(fixture.componentInstance.recoveryCodes()).toHaveLength(0);
    });

    it('refuses to submit a half-typed code', async () => {
      const fixture = await build();
      fixture.componentInstance.setupStage.set('scanning');
      fixture.componentInstance.code.set('123');
      fixture.componentInstance.confirmTwoFactorSetup();

      expect(security.confirmTwoFactorSetup).not.toHaveBeenCalled();
    });

    it('keeps the wizard open when the code is rejected', async () => {
      const fixture = await build();
      fixture.componentInstance.beginSetup('totp');
      fixture.componentInstance.setupStage.set('scanning');
      fixture.componentInstance.code.set('000000');

      security.confirmTwoFactorSetup.mockReturnValueOnce(
        throwError(() => ({ error: { message: 'nope' } })),
      );
      fixture.componentInstance.confirmTwoFactorSetup();
      await fixture.whenStable();

      expect(fixture.componentInstance.setupStage()).toBe('scanning');
      expect(fixture.componentInstance.busy()).toBe(false);
    });
  });

  describe('removing a factor', () => {
    it('names the factor being removed', async () => {
      const fixture = await build();
      twoFactor.set(
        status({
          enabled: true,
          methods: ['totp', 'email'],
          totp_enabled: true,
          email_enabled: true,
        }),
      );

      fixture.componentInstance.beginDisable('email');
      fixture.componentInstance.code.set('123456');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.confirmDisable();

      expect(security.disableTwoFactor).toHaveBeenCalledWith(
        '123456',
        'pw',
        'email',
      );
    });

    it('omits the method when turning everything off', async () => {
      const fixture = await build();
      twoFactor.set(status({ enabled: true, methods: ['totp'], totp_enabled: true }));

      fixture.componentInstance.beginDisable('all');
      fixture.componentInstance.code.set('123456');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.confirmDisable();

      expect(security.disableTwoFactor).toHaveBeenCalledWith(
        '123456',
        'pw',
        undefined,
      );
    });

    it('stays signed in when another factor remains', async () => {
      const fixture = await build();
      twoFactor.set(
        status({
          enabled: true,
          methods: ['totp', 'email'],
          totp_enabled: true,
          email_enabled: true,
        }),
      );

      security.disableTwoFactor.mockReturnValueOnce(
        of(
          removed({
            enabled: true,
            methods: ['totp'],
            totp_enabled: true,
            signedOut: false,
          }),
        ),
      );

      fixture.componentInstance.beginDisable('email');
      fixture.componentInstance.code.set('123456');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.confirmDisable();
      await fixture.whenStable();

      // The server only revokes everything when the account drops to a bare
      // password. Bouncing to the login screen here would be a lie about what
      // just happened.
      expect(authService.handleAuthFailure).not.toHaveBeenCalled();
    });

    it('signs out when the last factor goes', async () => {
      const fixture = await build();
      twoFactor.set(status({ enabled: true, methods: ['totp'], totp_enabled: true }));

      security.disableTwoFactor.mockReturnValueOnce(of(removed()));

      fixture.componentInstance.beginDisable('totp');
      fixture.componentInstance.code.set('123456');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.confirmDisable();
      await fixture.whenStable();

      expect(authService.handleAuthFailure).toHaveBeenCalled();
    });

    it('sends the password as typed here too', async () => {
      const fixture = await build();
      twoFactor.set(status({ enabled: true, methods: ['totp'], totp_enabled: true }));

      fixture.componentInstance.beginDisable('totp');
      fixture.componentInstance.code.set('123456');
      fixture.componentInstance.password.set(' pw ');
      fixture.componentInstance.confirmDisable();

      expect(security.disableTwoFactor).toHaveBeenCalledWith(
        '123456',
        ' pw ',
        'totp',
      );
    });

    it('needs both a code and a password', async () => {
      const fixture = await build();
      fixture.componentInstance.beginDisable('totp');

      fixture.componentInstance.code.set('123456');
      fixture.componentInstance.confirmDisable();
      expect(security.disableTwoFactor).not.toHaveBeenCalled();

      fixture.componentInstance.code.set('');
      fixture.componentInstance.password.set('pw');
      fixture.componentInstance.confirmDisable();
      expect(security.disableTwoFactor).not.toHaveBeenCalled();
    });

    it('knows when a removal leaves the account bare', async () => {
      const fixture = await build();
      twoFactor.set(
        status({
          enabled: true,
          methods: ['totp', 'email'],
          totp_enabled: true,
          email_enabled: true,
        }),
      );

      fixture.componentInstance.beginDisable('email');
      expect(fixture.componentInstance.disarmLeavesAccountBare()).toBe(false);

      twoFactor.set(
        status({ enabled: true, methods: ['email'], email_enabled: true }),
      );
      fixture.componentInstance.beginDisable('email');
      expect(fixture.componentInstance.disarmLeavesAccountBare()).toBe(true);
    });

    it('can fetch a code for an account whose only factor is email', async () => {
      const fixture = await build();
      twoFactor.set(
        status({ enabled: true, methods: ['email'], email_enabled: true }),
      );

      // Without this the user has no authenticator to read a code off and no
      // challenge cookie to use the sign-in send, so the only way to turn the
      // factor off would be to spend a recovery code.
      fixture.componentInstance.beginDisable('email');
      fixture.componentInstance.sendDisableEmailCode();
      await fixture.whenStable();

      expect(security.sendEmailTwoFactorChallenge).toHaveBeenCalled();
      expect(fixture.componentInstance.emailSentTo()).toBe(
        'someone@example.test',
      );
    });
  });

  describe('the code field', () => {
    it('keeps a dashed recovery code intact', async () => {
      const fixture = await build();
      fixture.componentInstance.onCodeInput('J3LT2-L3N43');
      expect(fixture.componentInstance.code()).toBe('J3LT2-L3N43');
    });

    it('strips what neither kind of code contains', async () => {
      const fixture = await build();
      fixture.componentInstance.onCodeInput('12 34/56');
      expect(fixture.componentInstance.code()).toBe('123456');
    });
  });
});
