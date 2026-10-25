import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OidcButtonsComponent } from './oidc-buttons.component';
import { AuthService } from '../../services/auth.service';
import { answerOidcProviders } from '../../testing/answer-oidc-providers';

/*
 * The buttons render what the server says it is configured for, and nothing
 * else: a button for a provider without credentials is one that always fails.
 */

const authService = { startOidc: vi.fn() };

const build = async (
  providers: unknown[] | 'error',
): Promise<ComponentFixture<OidcButtonsComponent>> => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [OidcButtonsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(withInterceptors([answerOidcProviders(providers)])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: authService },
    ],
  });

  const fixture = TestBed.createComponent(OidcButtonsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
};

const buttons = (fixture: ComponentFixture<OidcButtonsComponent>) =>
  Array.from(
    fixture.nativeElement.querySelectorAll('button'),
  ) as HTMLButtonElement[];

describe('OidcButtonsComponent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one button per provider the server offers', async () => {
    const fixture = await build(['google', 'github']);
    expect(buttons(fixture).map((b) => b.textContent?.trim())).toEqual([
      'Continue with Google',
      'Continue with GitHub',
    ]);
  });

  it('drops a provider this build has no button for', async () => {
    const fixture = await build(['github', 'gitlab']);
    expect(buttons(fixture)).toHaveLength(1);
  });

  it('renders nothing — not even the separator — when none is offered', async () => {
    expect((await build([])).nativeElement.textContent.trim()).toBe('');
  });

  it('renders nothing when the server cannot say', async () => {
    expect((await build('error')).nativeElement.textContent.trim()).toBe('');
  });

  it('leaves for the provider once, however often it is clicked', async () => {
    const fixture = await build(['github']);
    const [github] = buttons(fixture);

    github.click();
    fixture.detectChanges();
    github.click();

    expect(authService.startOidc).toHaveBeenCalledTimes(1);
    expect(authService.startOidc).toHaveBeenCalledWith('github');
    expect(github.disabled).toBe(true);
  });
});
