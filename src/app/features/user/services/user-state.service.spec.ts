import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserStateService } from './user-state.service';
import { UserI } from '../interfaces/user.interface';
import { ParticipantI } from '../../messages/interfaces/participant.interface';

/*
 * The signed-in user and the profile being viewed, plus one flag.
 *
 * The flag is the interesting part. `emailVerificationRequired` lives here
 * rather than on AuthService so the HTTP interceptor can set it without
 * injecting the service that owns the HttpClient it runs inside — and it is
 * driven by the server's *refusal* rather than by a client-side copy of
 * whether verification is enforced, because a mirrored deployment setting is
 * one redeploy away from showing a wall to users the server is happy to serve.
 */

const user = (overrides: Partial<UserI> = {}): UserI =>
  ({
    _id: 'u1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    username: 'ada',
    bio: '',
    email: 'ada@example.com',
    password: '',
    is_email_verified: true,
    login_attempts: 0,
    status: 'online',
    last_seen: new Date().toISOString(),
    blocked_users: [],
    ...overrides,
  }) as UserI;

const participant = (id = 'p1'): ParticipantI =>
  ({
    _id: id,
    first_name: 'Grace',
    last_name: 'Hopper',
    username: 'grace',
    bio: '',
    blocked_users: [],
  }) as ParticipantI;

const build = () => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection()],
  });
  return TestBed.inject(UserStateService);
};

describe('UserStateService', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  describe('the current user', () => {
    it('starts with nobody signed in', () => {
      const service = build();
      expect(service.currentUser()).toBeNull();
      expect(service.getCurrentUserId()).toBeNull();
    });

    it('holds the user it is given', () => {
      const service = build();
      service.setCurrentUser(user());

      expect(service.currentUser()?.username).toBe('ada');
      expect(service.getCurrentUserId()).toBe('u1');
    });

    it('recognises the signed-in user by id', () => {
      // Drives "is this my message?" on every bubble.
      const service = build();
      service.setCurrentUser(user({ _id: 'u1' }));

      expect(service.isCurrentUser('u1')).toBe(true);
      expect(service.isCurrentUser('u2')).toBe(false);
    });

    it('recognises nobody when signed out', () => {
      // Must not report a match on undefined, or every message renders as the
      // user's own.
      const service = build();
      expect(service.isCurrentUser('u1')).toBe(false);
      expect(service.isCurrentUser('')).toBe(false);
    });

    it('clears on sign-out', () => {
      const service = build();
      service.setCurrentUser(user());
      service.setCurrentUser(null);

      expect(service.currentUser()).toBeNull();
      expect(service.getCurrentUserId()).toBeNull();
    });

    it('exposes the user as read-only', () => {
      // Writes go through setCurrentUser so the verification flag stays in
      // step; a directly settable signal would let a caller skip that.
      const service = build();
      expect('set' in service.currentUser).toBe(false);
    });
  });

  describe('the email verification wall', () => {
    it('is down until the server refuses something', () => {
      const service = build();
      expect(service.emailVerificationRequired()).toBe(false);
    });

    it('goes up when the interceptor reports a refusal', () => {
      const service = build();
      service.flagEmailVerificationRequired();

      expect(service.emailVerificationRequired()).toBe(true);
    });

    it('comes down when a verified user is loaded', () => {
      // This is what makes "I've verified" take effect without a reload — the
      // account screen re-reads the user, and the wall drops.
      const service = build();
      service.flagEmailVerificationRequired();

      service.setCurrentUser(user({ is_email_verified: true }));

      expect(service.emailVerificationRequired()).toBe(false);
    });

    it('stays up when the reloaded user is still unverified', () => {
      const service = build();
      service.flagEmailVerificationRequired();

      service.setCurrentUser(user({ is_email_verified: false }));

      expect(service.emailVerificationRequired()).toBe(true);
    });

    it('stays up across a sign-out', () => {
      /*
       * `setCurrentUser(null)` reads `user?.is_email_verified`, which is
       * undefined and therefore falsy, so the flag survives. Pinned because it
       * is a consequence of the optional chain rather than an explicit
       * decision — and it is the behaviour you want either way, since signing
       * out does not verify anything.
       */
      const service = build();
      service.flagEmailVerificationRequired();

      service.setCurrentUser(null);

      expect(service.emailVerificationRequired()).toBe(true);
    });

    it('does not go up merely because an unverified user signed in', () => {
      // The wall is the server's call. Raising it here would reinstate exactly
      // the mirrored-configuration problem this design avoids.
      const service = build();
      service.setCurrentUser(user({ is_email_verified: false }));

      expect(service.emailVerificationRequired()).toBe(false);
    });
  });

  describe('the selected user', () => {
    it('starts empty', () => {
      expect(build().selectedUser()).toBeNull();
    });

    it('restores the profile being viewed across a reload', () => {
      // Survives a refresh on a profile page, which is a route the app can be
      // deep-linked into.
      sessionStorage.setItem('selectedUser', JSON.stringify(participant('p9')));

      expect(build().selectedUser()?._id).toBe('p9');
    });

    it('discards a corrupt stored value instead of throwing', () => {
      /*
       * A JSON.parse failure in a root service's constructor happens during
       * app bootstrap — it takes the whole app down with a blank screen, for a
       * value that only decides which profile is highlighted.
       */
      sessionStorage.setItem('selectedUser', '{not json');

      const service = build();

      expect(service.selectedUser()).toBeNull();
      expect(sessionStorage.getItem('selectedUser')).toBeNull();
    });

    it('leaves storage alone when there is nothing stored', () => {
      expect(() => build()).not.toThrow();
      expect(build().selectedUser()).toBeNull();
    });

    it('holds and clears the selection', () => {
      const service = build();
      service.setSelectedUser(participant('p1'));
      expect(service.selectedUser()?._id).toBe('p1');

      service.setSelectedUser(null);
      expect(service.selectedUser()).toBeNull();
    });

    it('is independent of the signed-in user', () => {
      // Viewing your own profile sets both; they must not be one signal.
      const service = build();
      service.setCurrentUser(user({ _id: 'u1' }));
      service.setSelectedUser(participant('p1'));

      expect(service.getCurrentUserId()).toBe('u1');
      expect(service.selectedUser()?._id).toBe('p1');
    });
  });
});
