import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterComponent } from './register.component';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../../../shared/services/theme.service';

/*
 * Why a rendering test rather than one that reads `form.errors`.
 *
 * The per-field messages on this form were keyed on `minLength` and
 * `maxLength`. Angular's keys are `minlength` and `maxlength`, so the four
 * blocks guarding them could never match and the messages could never appear —
 * while the form itself was correctly invalid the whole time. Any test that
 * asserted on the FormGroup would have passed throughout; only rendering the
 * template and reading what a user would see distinguishes a wired message from
 * a dead one.
 */

const authService = {
  register: vi.fn(() => of({ message: 'ok' })),
};

const build = async (): Promise<ComponentFixture<RegisterComponent>> => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [RegisterComponent],
    providers: [
      provideZonelessChangeDetection(),
      // A successful registration navigates here; without the route the
      // redirect rejects and Vitest reports it as an unhandled error.
      provideRouter([{ path: 'auth/login', children: [] }]),
      { provide: AuthService, useValue: authService },
      { provide: ThemeService, useValue: { isDarkMode: signal(false) } },
    ],
  });

  const fixture = TestBed.createComponent(RegisterComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
};

const text = (fixture: ComponentFixture<RegisterComponent>): string =>
  fixture.nativeElement.textContent ?? '';

const fill = (
  fixture: ComponentFixture<RegisterComponent>,
  values: Record<string, string>,
): void => {
  fixture.componentInstance.form.patchValue(values);
};

const submit = async (
  fixture: ComponentFixture<RegisterComponent>,
): Promise<void> => {
  fixture.componentInstance.onSubmit();
  await fixture.whenStable();
  fixture.detectChanges();
};

describe('RegisterComponent — telling the user what is wrong', () => {
  beforeEach(() => {
    authService.register.mockReset();
    authService.register.mockReturnValue(of({ message: 'ok' }));
  });

  it('renders the length message for a too-short username', async () => {
    const fixture = await build();

    fill(fixture, {
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ab',
      email: 'ada@example.test',
      password: 'quiet river stone bridge',
      repeat_password: 'quiet river stone bridge',
    });
    await submit(fixture);

    expect(text(fixture)).toContain('Min 3 characters');
  });

  it('renders the character rule the form never used to state', async () => {
    const fixture = await build();

    fill(fixture, {
      first_name: 'Ada',
      last_name: 'Lovelace',
      // The obvious thing to type into a field a person reads as a name, and
      // the server's `USERNAME_PATTERN` refuses it.
      username: 'ada lovelace',
      email: 'ada@example.test',
      password: 'quiet river stone bridge',
      repeat_password: 'quiet river stone bridge',
    });
    await submit(fixture);

    expect(text(fixture)).toContain('no spaces');
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('names the offending field in the banner instead of "all fields"', async () => {
    const fixture = await build();

    fill(fixture, {
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'adalovelace',
      email: 'not-an-address',
      password: 'quiet river stone bridge',
      repeat_password: 'quiet river stone bridge',
    });
    await submit(fixture);

    expect(fixture.componentInstance.error()).toContain('Email');
    expect(fixture.componentInstance.error()).not.toContain('all fields');
  });

  it('accepts a two-character first name, as the server does', async () => {
    // The form demanded 3 characters where the API asks for 1, so "Li" was a
    // dead end with no explanation naming the field.
    const fixture = await build();

    fill(fixture, {
      first_name: 'Li',
      last_name: 'Wu',
      username: 'liwu',
      email: 'li@example.test',
      password: 'quiet river stone bridge',
      repeat_password: 'quiet river stone bridge',
    });
    await submit(fixture);

    expect(authService.register).toHaveBeenCalledOnce();
  });

  it('places a server refusal on the field it names', async () => {
    authService.register.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              message: 'Validation failed',
              errors: [
                { field: 'username', msg: 'That username is already taken' },
              ],
            },
          }),
      ),
    );

    const fixture = await build();

    fill(fixture, {
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'adalovelace',
      email: 'ada@example.test',
      password: 'quiet river stone bridge',
      repeat_password: 'quiet river stone bridge',
    });
    await submit(fixture);

    // Under the input, not only in the banner.
    expect(text(fixture)).toContain('That username is already taken');
    // And the banner says the reason rather than "Validation failed".
    expect(fixture.componentInstance.error()).toContain('already taken');
    expect(fixture.componentInstance.error()).not.toContain(
      'Validation failed',
    );
  });
});
