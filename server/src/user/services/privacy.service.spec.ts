import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  broadcastsPresence,
  redactForViewer,
  withPrivacyDefaults,
} from './privacy.service';

/*
 * Redaction happens on the way out, so a mistake here is a privacy setting that
 * silently does nothing — the screen still shows the dropdown, the value is
 * still stored, and the field is still served. That is the exact failure this
 * feature was built to correct, so it is worth pinning.
 */

const VIEWER = new Types.ObjectId().toString();
const TARGET = new Types.ObjectId().toString();

const user = (privacy?: Record<string, string>) => ({
  _id: TARGET,
  username: 'target',
  bio: 'hello',
  last_seen: new Date('2026-01-01'),
  pfp_url: 'https://example.test/a.png',
  pfp_variants: { thumb: 'https://example.test/t.png' },
  status: 'online',
  privacy,
});

const noContacts = new Set<string>();
const asContact = new Set<string>([TARGET]);

describe('withPrivacyDefaults', () => {
  it('defaults every key to everyone for documents predating the feature', () => {
    expect(withPrivacyDefaults(undefined)).toEqual({
      last_seen: 'everyone',
      pfp_url: 'everyone',
      bio: 'everyone',
      online_status: 'everyone',
    });
    expect(withPrivacyDefaults(null)).toEqual(withPrivacyDefaults(undefined));
  });

  it('keeps the keys that are set and defaults the rest', () => {
    expect(withPrivacyDefaults({ bio: 'nobody' })).toMatchObject({
      bio: 'nobody',
      last_seen: 'everyone',
    });
  });
});

describe('redactForViewer', () => {
  it('shows everything to the owner, settings included', () => {
    const seen = redactForViewer(user({ bio: 'nobody' }), TARGET, noContacts);
    expect(seen.bio).toBe('hello');
    expect(seen.privacy).toBeDefined();
  });

  it('never leaks the privacy settings to anyone else', () => {
    // They describe the owner's choices and are nobody else's business —
    // knowing someone set `last_seen: nobody` is itself information.
    const seen = redactForViewer(user(), VIEWER, asContact);
    expect(seen).not.toHaveProperty('privacy');
  });

  it('hides a nobody-scoped field from every other viewer', () => {
    const fromContact = redactForViewer(
      user({ bio: 'nobody', last_seen: 'nobody' }),
      VIEWER,
      asContact,
    );
    expect(fromContact).not.toHaveProperty('bio');
    expect(fromContact).not.toHaveProperty('last_seen');
  });

  it('shows a contacts-scoped field to a contact and not to a stranger', () => {
    const scoped = { bio: 'contacts', pfp_url: 'contacts' };

    const toContact = redactForViewer(user(scoped), VIEWER, asContact);
    expect(toContact.bio).toBe('hello');
    expect(toContact.pfp_url).toBeDefined();

    const toStranger = redactForViewer(user(scoped), VIEWER, noContacts);
    expect(toStranger).not.toHaveProperty('bio');
    expect(toStranger).not.toHaveProperty('pfp_url');
  });

  it('drops the avatar variants along with the avatar', () => {
    // Leaving `pfp_variants` behind would serve the same image at a different
    // size — the setting would look applied and not be.
    const seen = redactForViewer(user({ pfp_url: 'nobody' }), VIEWER, asContact);
    expect(seen).not.toHaveProperty('pfp_url');
    expect(seen).not.toHaveProperty('pfp_variants');
  });

  it('reports hidden presence as offline rather than removing the field', () => {
    // The client renders a status dot for everyone; an absent status lights it
    // up as "unknown" instead of simply not showing them as online.
    const seen = redactForViewer(
      user({ online_status: 'nobody' }),
      VIEWER,
      asContact,
    );
    expect(seen.status).toBe('offline');
  });

  it('does not mutate the document it was given', () => {
    const original = user({ bio: 'nobody' });
    redactForViewer(original, VIEWER, noContacts);
    expect(original.bio).toBe('hello');
    expect(original.privacy).toEqual({ bio: 'nobody' });
  });
});

describe('broadcastsPresence', () => {
  it('is true unless presence is set to nobody', () => {
    expect(broadcastsPresence(undefined)).toBe(true);
    expect(broadcastsPresence({ online_status: 'everyone' })).toBe(true);
    expect(broadcastsPresence({ online_status: 'contacts' })).toBe(true);
    expect(broadcastsPresence({ online_status: 'nobody' })).toBe(false);
  });
});
