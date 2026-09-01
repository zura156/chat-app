import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../../../shared/services/theme.service';
import { TwoFactorMethod } from '../../interfaces/two-factor.interface';

/*
 * The second-factor step of signing in.
 *
 * The bug that motivated most of this file: the code form was declared as
 *
 *   <form (ngSubmit)="submitTwoFactorCode()">
 *
 * with no `[formGroup]`, in a component that imports ReactiveFormsModule but
 * not FormsModule. `ngSubmit` is an output of NgForm (FormsModule) and of
 * FormGroupDirective (which only matches `[formGroup]`), so neither directive
 * attached and the binding was left listening for a DOM event named "ngSubmit"
 * that nothing dispatches. Pressing Verify therefore fell through to the
 * browser's native form submission: the page reloaded back to the sign-in
 * screen, no request was ever made, and no error appeared — the second factor
 * simply could not be completed. The credentials form escaped it only because
 * it carries `[formGroup]`.
 *
 * A test that calls `submitTwoFactorCode()` directly would have passed
 * throughout. These dispatch a real `submit` event at the real <form>, which is
 * the only thing that distinguishes a bound handler from an unbound one.
 */

const twoFactorRequired = signal(false);
const twoFactorMethods = signal<TwoFactorMethod[]>([]);
const twoFactorMethod = signal<TwoFactorMethod>('totp');

const authService = {
  twoFactorRequired,
  twoFactorMethods,
  twoFactorMethod,
  login: vi.fn(() => of(null)),
  submitTwoFactorCode: vi.fn(() => of(null)),
  requestTwoFactorEmailCode: vi.fn(() => of({ message: 'sent' })),
  chooseTwoFactorMethod: vi.fn((method: TwoFactorMethod) =>
    twoFactorMethod.set(method),
  ),
  cancelTwoFactor: vi.fn(() => {
    twoFactorRequired.set(false);
    twoFactorMethods.set([]);
  }),
};

const build = async (): Promise<ComponentFixture<LoginComponent>> => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AuthService, useValue: authService },
      { provide: ThemeService, useValue: { isDarkMode: signal(false) } },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
};

/** The second-factor form, which only exists once a challenge is outstanding. */
const codeForm = (fixture: ComponentFixture<LoginComponent>): HTMLFormElement => {
  const forms = Array.from(
    fixture.nativeElement.querySelectorAll('form'),
  ) as HTMLFormElement[];

  // The credentials form is the one with a formGroup; the code form is the
  // other. Selecting by its heading rather than by index so a template reshuffle
  // fails loudly instead of silently testing the wrong element.
  const found = forms.find((form) =>
    form.getAttribute('aria-labelledby')?.includes('two-factor'),
  );
  if (!found) throw new Error('two-factor form not rendered');
  return found;
};

/** Puts the component into the state a correct password leaves it in. */
const challenge = async (
  fixture: ComponentFixture<LoginComponent>,
  methods: TwoFactorMethod[],
) => {
  twoFactorMethods.set(methods);
  twoFactorMethod.set(methods[0]);
  twoFactorRequired.set(true);
  await fixture.whenStable();
  fixture.detectChanges();
};

/** Types into a detached input and hands it to the component's handler. */
const typeInto = (
  fixture: { componentInstance: { onTwoFactorCodeInput(event: Event): void } },
  value: string,
): HTMLInputElement => {
  const input = document.createElement('input');
  input.value = value;
  fixture.componentInstance.onTwoFactorCodeInput({
    target: input,
  } as unknown as Event);
  return input;
};

describe('LoginComponent — second factor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    twoFactorRequired.set(false);
    twoFactorMethods.set([]);
    twoFactorMethod.set('totp');
  });

  it('does not show the code step until a factor is outstanding', async () => {
    const fixture = await build();
    const forms = fixture.nativeElement.querySelectorAll('form');

    expect(forms).toHaveLength(1);
  });

  describe('submitting the code', () => {
    it('handles the form submission instead of letting the browser take it', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp']);

      fixture.componentInstance.twoFactorCode.set('123456');
      await fixture.whenStable();

      const event = new Event('submit', { bubbles: true, cancelable: true });
      codeForm(fixture).dispatchEvent(event);
      await fixture.whenStable();

      // The two halves of the bug. Unbound, the handler never ran *and* the
      // default was never prevented, so the browser navigated and the page
      // came back up on the sign-in screen with the code field empty.
      expect(authService.submitTwoFactorCode).toHaveBeenCalledWith('123456');
      expect(event.defaultPrevented).toBe(true);
    });

    it('submits when the Verify button is clicked', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp']);

      fixture.componentInstance.twoFactorCode.set('123456');
      await fixture.whenStable();
      fixture.detectChanges();

      const verify = Array.from(
        codeForm(fixture).querySelectorAll('button'),
      ).find((button) => button.textContent?.trim() === 'Verify');

      // `type="submit"` is what routes the click into the form, and is exactly
      // what made the unbound binding fall through to a native submission.
      expect(verify?.getAttribute('type')).toBe('submit');

      verify?.click();
      await fixture.whenStable();

      expect(authService.submitTwoFactorCode).toHaveBeenCalledWith('123456');
    });

    it('does nothing on an empty code', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp']);

      codeForm(fixture).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();

      expect(authService.submitTwoFactorCode).not.toHaveBeenCalled();
    });

    it('surfaces a rejected code instead of failing silently', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp']);

      authService.submitTwoFactorCode.mockReturnValueOnce(
        throwError(() => 'That code is not correct'),
      );
      fixture.componentInstance.twoFactorCode.set('000000');
      await fixture.whenStable();

      codeForm(fixture).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      await fixture.whenStable();

      expect(fixture.componentInstance.error()).toBe(
        'That code is not correct',
      );
      // Cleared so the next attempt starts from an empty field rather than the
      // rejected code.
      expect(fixture.componentInstance.twoFactorCode()).toBe('');
    });
  });

  describe('choosing between factors', () => {
    it('offers no chooser when only one factor is enrolled', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp']);

      expect(fixture.componentInstance.canChooseMethod()).toBe(false);
      expect(
        fixture.nativeElement.querySelector('[aria-label="Choose how to verify"]'),
      ).toBeNull();
    });

    it('offers a chooser when both are', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp', 'email']);

      expect(fixture.componentInstance.canChooseMethod()).toBe(true);
      expect(
        fixture.nativeElement.querySelector('[aria-label="Choose how to verify"]'),
      ).not.toBeNull();
    });

    it('switches factor and drops a half-typed code', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp', 'email']);

      fixture.componentInstance.twoFactorCode.set('1234');
      fixture.componentInstance.chooseMethod('email');
      await fixture.whenStable();

      expect(authService.chooseTwoFactorMethod).toHaveBeenCalledWith('email');
      // A code meant for the authenticator is not a code for the email factor.
      expect(fixture.componentInstance.twoFactorCode()).toBe('');
    });

    it('ignores a switch to the factor already selected', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp', 'email']);

      fixture.componentInstance.twoFactorCode.set('1234');
      fixture.componentInstance.chooseMethod('totp');

      // Re-selecting the current tab must not wipe what the user has typed.
      expect(authService.chooseTwoFactorMethod).not.toHaveBeenCalled();
      expect(fixture.componentInstance.twoFactorCode()).toBe('1234');
    });

    it('keeps the chooser buttons out of the form submission', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp', 'email']);

      const chooser = fixture.nativeElement.querySelector(
        '[aria-label="Choose how to verify"]',
      ) as HTMLElement;

      // Inside a <form>, a button with no type defaults to submit — these would
      // then send the code on every tab switch.
      for (const button of Array.from(chooser.querySelectorAll('button'))) {
        expect((button as HTMLButtonElement).getAttribute('type')).toBe('button');
      }
    });
  });

  describe('the email factor', () => {
    it('offers to send a code, and remembers that it did', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp', 'email']);
      fixture.componentInstance.chooseMethod('email');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.emailCodeSent()).toBe(false);

      fixture.componentInstance.sendEmailCode();
      await fixture.whenStable();

      expect(authService.requestTwoFactorEmailCode).toHaveBeenCalled();
      expect(fixture.componentInstance.emailCodeSent()).toBe(true);
    });

    it('treats an email-only account as already sent', async () => {
      // The server sends the code as part of answering the password step when
      // there is nothing else the user could read one off, so the screen must
      // not open on "Email me a code" as though nothing has happened.
      const fixture = await build();
      twoFactorMethods.set(['email']);
      twoFactorMethod.set('email');
      twoFactorRequired.set(true);

      fixture.componentInstance.form.setValue({
        email: 'someone@example.test',
        password: 'a-password',
      });
      fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      expect(fixture.componentInstance.emailCodeSent()).toBe(true);
    });

    it('does not claim a code was sent when an authenticator is also enrolled', async () => {
      const fixture = await build();
      twoFactorMethods.set(['totp', 'email']);
      twoFactorMethod.set('totp');
      twoFactorRequired.set(true);

      fixture.componentInstance.form.setValue({
        email: 'someone@example.test',
        password: 'a-password',
      });
      fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      expect(fixture.componentInstance.emailCodeSent()).toBe(false);
    });
  });

  describe('going back', () => {
    it('clears the challenge and the typed code', async () => {
      const fixture = await build();
      await challenge(fixture, ['totp']);
      fixture.componentInstance.twoFactorCode.set('123456');

      fixture.componentInstance.cancelTwoFactor();
      await fixture.whenStable();

      expect(authService.cancelTwoFactor).toHaveBeenCalled();
      expect(fixture.componentInstance.twoFactorCode()).toBe('');
      expect(fixture.componentInstance.emailCodeSent()).toBe(false);
    });
  });

  describe('the code field', () => {
    it('accepts a six-digit code', async () => {
      const fixture = await build();
      const input = typeInto(fixture, '123456');
      expect(fixture.componentInstance.twoFactorCode()).toBe('123456');
      expect(input.value).toBe('123456');
    });

    it('accepts a dashed recovery code', async () => {
      const fixture = await build();
      const input = typeInto(fixture, 'J3LT2-L3N43');
      expect(fixture.componentInstance.twoFactorCode()).toBe('J3LT2-L3N43');
      expect(input.value).toBe('J3LT2-L3N43');
    });

    it('strips characters neither kind of code contains', async () => {
      const fixture = await build();
      const input = typeInto(fixture, '12 34/56!');
      expect(fixture.componentInstance.twoFactorCode()).toBe('123456');
      /*
       * The element, not just the signal.
       *
       * The field is bound `[value]="twoFactorCode()"` with a sanitising
       * `(input)`. When the sanitiser strips a character the signal's value is
       * unchanged, so Angular's property binding sees no difference and never
       * writes back — which left the rejected character sitting on screen while
       * the model had already dropped it.
       */
      expect(input.value).toBe('123456');
    });

    it('stops at the length of the longer code', async () => {
      const fixture = await build();
      const input = typeInto(fixture, 'ABCDE-FGHIJKLMNOP');
      expect(fixture.componentInstance.twoFactorCode()).toHaveLength(11);
      expect(input.value).toHaveLength(11);
    });
  });

  describe('whitespace in the credentials', () => {
    /*
     * The asymmetry that is easy to get backwards, and which nothing else
     * states: the address is trimmed, the password is not.
     *
     * A trailing space on an address is an artefact of copy-paste or a phone
     * keyboard and never part of the address. A trailing space in a password is
     * part of the secret — the server hashes exactly what it is sent and trims
     * nothing — so trimming here would send a different password than the one
     * the account was created with, and refuse a correct one.
     */

    const submit = async (email: string, password: string) => {
      const fixture = await build();
      fixture.componentInstance.form.setValue({ email, password });
      fixture.componentInstance.onSubmit();
      await fixture.whenStable();
      return fixture;
    };

    it('trims the address', async () => {
      await submit('  ada@example.test  ', 'correct-horse');

      expect(authService.login).toHaveBeenCalledWith({
        email: 'ada@example.test',
        password: 'correct-horse',
      });
    });

    it('leaves a password that ends in a space exactly as typed', async () => {
      await submit('ada@example.test', 'correct-horse ');

      expect(authService.login).toHaveBeenCalledWith({
        email: 'ada@example.test',
        password: 'correct-horse ',
      });
    });

    it('leaves a password that is nothing but spaces alone too', async () => {
      // Refusing it is the validator's job, not the submit handler's. Trimming
      // it to empty here would send a different credential than was typed.
      await submit('ada@example.test', '   ');

      expect(authService.login).toHaveBeenCalledWith({
        email: 'ada@example.test',
        password: '   ',
      });
    });
  });
});
