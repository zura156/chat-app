import { provideZonelessChangeDetection, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { PrivacyPolicy } from './components/privacy-policy/privacy-policy';
import { TermsOfUse } from './components/terms-of-use/terms-of-use';
import { CookiePolicy } from './components/cookie-policy/cookie-policy';
import { LEGAL, MISSING_LEGAL_FACTS } from './legal.config';

/*
 * The one property these pages must keep: nobody needs a session to read them.
 * A privacy policy behind a login is not published — the register page,
 * app-store listings and regulators all link here cold — and a guard added to
 * the parent route "for consistency" would break that silently, because every
 * developer testing it is signed in.
 */
describe('legal routes', () => {
  it('mounts /legal with no guard', () => {
    const legal = routes.find((route) => route.path === 'legal');

    expect(legal).toBeDefined();
    expect(legal?.canActivate).toBeUndefined();
    expect(legal?.canMatch).toBeUndefined();
    expect(legal?.canActivateChild).toBeUndefined();
  });

  it('is declared before the catch-all', () => {
    const paths = routes.map((route) => route.path);

    expect(paths.indexOf('legal')).toBeLessThan(paths.indexOf('**'));
  });
});

const render = async (component: Type<unknown>) => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [component],
    providers: [provideZonelessChangeDetection(), provideRouter([])],
  });
  const fixture = TestBed.createComponent(component);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

describe.each([
  ['Privacy Policy', PrivacyPolicy],
  ['Terms of Use', TermsOfUse],
  ['Cookies & Storage', CookiePolicy],
] as const)('%s page', (title, component) => {
  it('renders its title and the last-updated date', async () => {
    const page = await render(component);

    expect(page.querySelector('h1')?.textContent?.trim()).toBe(title);
    const time = page.querySelector('.meta time');
    expect(time?.getAttribute('datetime')).toBe(LEGAL.lastUpdated);

    // DatePipe reads a date-only string as local midnight. Formatting it in
    // UTC on top of that printed the day before everywhere east of Greenwich.
    const day = String(Number(LEGAL.lastUpdated.slice(8, 10)));
    expect(time?.textContent).toMatch(new RegExp(`\\b${day}\\b`));
  });

  it('marks every unset operator fact instead of printing nothing', async () => {
    const page = await render(component);
    const marks = page.querySelectorAll('mark').length;

    // Every page cites at least the contact address.
    if (MISSING_LEGAL_FACTS.length === 0) {
      expect(marks).toBe(0);
    } else {
      expect(marks).toBeGreaterThan(0);
    }
  });
});

describe('analytics disclosure', () => {
  /*
   * Cloudflare injects its Web Analytics beacon at the edge, so nothing in this
   * repo loads it and no build would notice the pages contradicting it. They
   * once said "we use no analytics" while it ran. If the beacon is turned off,
   * delete this block along with the disclosures it guards.
   */
  it.each([
    ['Privacy Policy', PrivacyPolicy],
    ['Cookies & Storage', CookiePolicy],
  ] as const)('%s names Cloudflare Web Analytics', async (_, component) => {
    const page = await render(component);

    expect(page.textContent).toContain('Cloudflare Web Analytics');
    expect(page.textContent).not.toMatch(/no analytics/i);
  });
});

describe('cookie page', () => {
  it('lists every cookie the API sets', async () => {
    const page = await render(CookiePolicy);
    const names = [...page.querySelectorAll('td code')].map(
      (cell) => cell.textContent,
    );

    // The full `res.cookie(...)` inventory of the server. A new cookie there
    // without a row here is an undisclosed cookie.
    expect(names).toEqual(
      expect.arrayContaining([
        'accessToken',
        'refreshToken',
        'csrfToken',
        'twoFactorChallenge',
        'oidcTx',
      ]),
    );
  });
});
