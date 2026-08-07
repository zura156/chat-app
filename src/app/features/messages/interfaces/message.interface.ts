import { ConversationI } from './conversation.interface';
import { ParticipantI } from './participant.interface';

export enum MessageType {
  INFO = 'info',
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  FILE = 'file',
}

export enum MessageStatus {
  FAILED = 'failed',
  SENDING = 'sending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
}

export interface AttachmentVariants {
  // video specific
  hls?: string;
  original?: string;
  thumbnail?: string;

  // image specific
  thumb?: string;
  medium?: string;
  large?: string;
}
export interface AttachmentI {
  uploadId: string;
  context: 'dm-image' | 'dm-video' | 'dm-file' | 'dm-audio';
  mimeType: string;
  fileSize: number;
  status: 'processing' | 'ready' | 'failed' | 'infected';
  variants: AttachmentVariants | null;
  duration?: number; // For audio/video files, in seconds
  originalName?: string;
}

export interface MessageI {
  _id?: string;
  tempId?: string;
  sender: Partial<ParticipantI>;
  conversation: ConversationI | string;
  attachments?: AttachmentI[];
  content?: string | null;
  type: MessageType;
  status: MessageStatus;
  timestamp: string;
  edited_at?: string;
  /**
   * Set when the sender deleted the message. The row survives because read
   * receipts reference message ids — see the server model — so the client
   * renders a tombstone rather than removing the bubble.
   */
  deleted_at?: string;
}

/**
 * What a deleted message is reduced to on the client, defined once.
 *
 * Mirrors the server's `deleteMessage`: everything describing what the message
 * *was* goes, and only what the thread is built on stays. Two lists apply it —
 * the open thread's and the conversation list's — and a third copy of the same
 * shape is how they would come to disagree, leaving the same message rendered
 * as deleted in one place and not the other.
 *
 * `type` is normalised rather than dropped because every `switch` over it, here
 * and on the server, is written against the enum; a tombstone is a line of
 * text, so TEXT is both true and already handled everywhere.
 */
export const deletedMessageFields = (deletedAt: string): Partial<MessageI> => ({
  content: null,
  attachments: [],
  edited_at: undefined,
  type: MessageType.TEXT,
  deleted_at: deletedAt,
});

export interface GroupedMessages {
  timeframe: string;
  messages: MessageI[];
}

// Add this method to your class
export function convertToMessageType(type: string): MessageType {
  switch (type) {
    case 'info':
      return MessageType.INFO;
    case 'text':
      return MessageType.TEXT;
    case 'image':
      return MessageType.IMAGE;
    case 'file':
      return MessageType.FILE;
    // Add other cases as needed
    default:
      return MessageType.TEXT; // Default fallback
  }
}
