import { Injectable, inject, signal } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';
import { apiErrorMessage } from '../../../shared/functions/api-error';
import { MessageI, MessageType } from '../interfaces/message.interface';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';

/**
 * Owns everything you can do to a message, so the pointer path (hover, ellipsis,
 * dropdown) and the touch path (press-and-hold, action sheet) drive the same
 * state instead of each card carrying its own copy.
 *
 * It also means the sheet and the delete confirmation exist once for the whole
 * thread rather than once per message — a long conversation renders every
 * message it has loaded, and there is no reason for each of them to carry an
 * overlay it will almost certainly never open.
 *
 * Provided alongside MessageService and ConversationService on the /messages
 * route, since it depends on both and shares their lifetime.
 */
@Injectable()
export class MessageActionsService {
  private readonly messageService = inject(MessageService);
  private readonly conversationService = inject(ConversationService);

  /** Non-null while the touch action sheet is up. */
  readonly sheetTarget = signal<MessageI | null>(null);
  /** Non-null while the delete confirmation is up. */
  readonly pendingDelete = signal<MessageI | null>(null);
  /** At most one message in the thread is editable at a time. */
  readonly editingId = signal<string | null>(null);
  readonly draft = signal<string>('');
  readonly busy = signal(false);

  // ── What a given message allows ─────────────────────────────────────────────

  /**
   * Only your own text, and only while it still exists. Attachments are not
   * editable — replacing the file behind a message someone already opened
   * changes what they were shown after the fact.
   */
  canEdit(message: MessageI, currentUserId?: string): boolean {
    return (
      this.isOwn(message, currentUserId) &&
      !message.deleted_at &&
      message.type === MessageType.TEXT
    );
  }

  canDelete(message: MessageI, currentUserId?: string): boolean {
    return (
      this.isOwn(message, currentUserId) &&
      !message.deleted_at &&
      message.type !== MessageType.INFO
    );
  }

  /** Text is copyable whoever sent it — the only action incoming messages get. */
  canCopy(message: MessageI): boolean {
    return (
      !message.deleted_at &&
      message.type === MessageType.TEXT &&
      !!message.content
    );
  }

  hasActions(message: MessageI, currentUserId?: string): boolean {
    return (
      this.canEdit(message, currentUserId) ||
      this.canDelete(message, currentUserId) ||
      this.canCopy(message)
    );
  }

  private isOwn(message: MessageI, currentUserId?: string): boolean {
    return (message.sender._id ?? message.sender) === currentUserId;
  }

  // ── Sheet ───────────────────────────────────────────────────────────────────

  openSheet(message: MessageI): void {
    this.sheetTarget.set(message);
  }

  closeSheet(): void {
    this.sheetTarget.set(null);
  }

  // ── Edit ────────────────────────────────────────────────────────────────────

  beginEdit(message: MessageI): void {
    this.closeSheet();
    this.editingId.set(message._id ?? null);
    this.draft.set(message.content ?? '');
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.draft.set('');
  }

  isEditing(message: MessageI): boolean {
    return !!message._id && this.editingId() === message._id;
  }

  saveEdit(message: MessageI): void {
    const content = this.draft().trim();
    const conversationId = this.conversationService.activeConversation()?._id;

    if (!content || !message._id || !conversationId) return;
    if (content === message.content) {
      this.cancelEdit();
      return;
    }

    this.busy.set(true);
    this.messageService
      .editMessage(conversationId, message._id, content)
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.cancelEdit();
        },
        error: (err) => {
          this.busy.set(false);
          toast.error(apiErrorMessage(err, 'Could not edit that message'));
        },
      });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  requestDelete(message: MessageI): void {
    this.closeSheet();
    this.pendingDelete.set(message);
  }

  cancelDelete(): void {
    if (this.busy()) return;
    this.pendingDelete.set(null);
  }

  confirmDelete(): void {
    const message = this.pendingDelete();
    const conversationId = this.conversationService.activeConversation()?._id;
    if (!message?._id || !conversationId) return;

    this.busy.set(true);
    this.messageService.deleteMessage(conversationId, message._id).subscribe({
      next: () => {
        this.busy.set(false);
        this.pendingDelete.set(null);
      },
      error: (err) => {
        this.busy.set(false);
        this.pendingDelete.set(null);
        toast.error(apiErrorMessage(err, 'Could not delete that message'));
      },
    });
  }

  // ── Copy ────────────────────────────────────────────────────────────────────

  async copy(message: MessageI): Promise<void> {
    this.closeSheet();
    if (!message.content) return;

    try {
      await navigator.clipboard.writeText(message.content);
      toast.success('Copied');
    } catch {
      // Clipboard access is refused outside a secure context, and on iOS it is
      // refused whenever the write is not judged to be user-initiated.
      toast.error('Could not copy that message');
    }
  }
}
