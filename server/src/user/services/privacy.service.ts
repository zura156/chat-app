import { Types } from 'mongoose';
import { Conversation } from '../../messenger/models/conversation.model';
import {
  IPrivacySettings,
  PRIVACY_KEYS,
  Visibility,
} from '../models/user.model';

/*
 * The privacy screen offered four visibility dropdowns backed by nothing: no
 * model, no GET, no PATCH, and no read path that consulted them. This is what
 * makes them mean something.
 *
 * Redaction happens on the way out rather than in the query, because the same
 * document is visible at different fidelities to different viewers and the
 * decision depends on the relationship between them.
 */

const DEFAULTS: IPrivacySettings = {
  last_seen: 'everyone',
  pfp_url: 'everyone',
  bio: 'everyone',
  online_status: 'everyone',
};

/** Documents written before this feature have no `privacy` object at all. */
export const withPrivacyDefaults = (
  privacy?: Partial<IPrivacySettings> | null,
): IPrivacySettings => ({
  ...DEFAULTS,
  ...Object.fromEntries(
    PRIVACY_KEYS.filter((key) => privacy?.[key]).map((key) => [
      key,
      privacy![key],
    ]),
  ),
});

/**
 * Everyone the user shares a conversation with. This is what `contacts` means:
 * there is no friend list in this app, so the only honest reading of "contacts"
 * is people you are actually in a conversation with.
 */
export const contactIdsFor = async (
  userId: string | Types.ObjectId,
): Promise<Set<string>> => {
  const conversations = await Conversation.find({ participants: userId })
    .select('participants')
    .lean();

  const contacts = new Set<string>();
  const self = String(userId);

  for (const conversation of conversations) {
    for (const participant of conversation.participants) {
      const id = participant.toString();
      if (id !== self) contacts.add(id);
    }
  }

  return contacts;
};

const isVisible = (
  visibility: Visibility,
  viewerIsSelf: boolean,
  viewerIsContact: boolean,
): boolean => {
  if (viewerIsSelf) return true;
  if (visibility === 'everyone') return true;
  if (visibility === 'contacts') return viewerIsContact;
  return false;
};

/** A user document as one particular viewer is allowed to see it. */
export const redactForViewer = <T extends { _id?: unknown; privacy?: unknown }>(
  user: T,
  viewerId: string,
  contactIds: Set<string>,
): T => {
  const targetId = String(user._id);
  const viewerIsSelf = targetId === viewerId;
  const viewerIsContact = contactIds.has(targetId);

  const privacy = withPrivacyDefaults(
    user.privacy as Partial<IPrivacySettings> | null | undefined,
  );
  const redacted: Record<string, unknown> = { ...user };

  // The settings never leave the account they belong to; they describe the
  // owner's choices and are nobody else's business.
  if (!viewerIsSelf) delete redacted['privacy'];

  if (!isVisible(privacy.last_seen, viewerIsSelf, viewerIsContact)) {
    delete redacted['last_seen'];
  }

  if (!isVisible(privacy.pfp_url, viewerIsSelf, viewerIsContact)) {
    delete redacted['pfp_url'];
    delete redacted['pfp_variants'];
  }

  if (!isVisible(privacy.bio, viewerIsSelf, viewerIsContact)) {
    delete redacted['bio'];
  }

  // Hidden presence reads as offline rather than as a missing field: the client
  // renders a status dot for everyone, and an absent status would light it up
  // as "unknown" instead of simply not showing them as online.
  if (!isVisible(privacy.online_status, viewerIsSelf, viewerIsContact)) {
    redacted['status'] = 'offline';
  }

  return redacted as T;
};

/** Whether this user's presence may be broadcast to other people at all. */
export const broadcastsPresence = (
  privacy?: Partial<IPrivacySettings> | null,
): boolean => withPrivacyDefaults(privacy).online_status !== 'nobody';
