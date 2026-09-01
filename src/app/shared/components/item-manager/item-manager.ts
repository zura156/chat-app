import { Component, computed, input, output, signal } from '@angular/core';
import { ModalStatesT } from '../../interfaces/modal-states.type';
import { HlmButton } from '@spartan-ng/helm/button';
import { ModalVariantsT } from '../../interfaces/modal-variants.type';
import { UserI } from '../../../features/user/interfaces/user.interface';
import { ParticipantI } from '../../../features/messages/interfaces/participant.interface';
import {
  HlmAvatar,
  HlmAvatarFallback,
  HlmAvatarImage,
} from '@spartan-ng/helm/avatar';
import { HttpErrorResponse } from '@angular/common/http';
import { toast } from '@spartan-ng/brain/sonner';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { summarizeFormErrors } from '../../functions/form.utils';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import {
  lucideCheck,
  lucideSearch,
  lucideUsers,
  lucideX,
} from '@ng-icons/lucide';

@Component({
  selector: 'app-item-manager',
  templateUrl: './item-manager.html',
  imports: [
    ReactiveFormsModule,
    HlmButton,
    HlmAvatarImage,
    HlmAvatar,
    HlmAvatarFallback,
    HlmSeparatorImports,
    NgIcon,
    HlmIcon,
  ],
  providers: [
    provideIcons({ lucideSearch, lucideUsers, lucideX, lucideCheck }),
  ],
})
export class ItemManagerComponent {
  headerText = input<string>();
  description = input<string>();
  variant = input<ModalVariantsT>('user-list');
  error = input<HttpErrorResponse>();
  isLoading = input<boolean>();
  isSubmitting = input<boolean>();
  submitVariant = input<'default' | 'destructive'>('default');
  actionName = input<string>('submit');
  items = input<(UserI | ParticipantI)[]>();
  form = input<FormGroup>();

  closed = output<void>();
  submit = output<any>();
  state = input<ModalStatesT>('closed');

  animationEnd = output<void>();

  /**
   * The search box was rendered but bound to nothing — no `formControl`, no
   * `(input)`, no filtering. Typing in it did nothing at all, which with a long
   * user list left no way to find anyone.
   */
  readonly searchQuery = signal('');

  /** What the list actually renders, narrowed by the search box. */
  readonly visibleItems = computed(() => {
    const all = this.items() ?? [];
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return all;

    return all.filter((item) =>
      `${item.first_name ?? ''} ${item.last_name ?? ''} ${item.username ?? ''}`
        .toLowerCase()
        .includes(query),
    );
  });

  /**
   * Selections are keyed by `_id`, not by position in the array.
   *
   * They used to be a `Set<number>` of `$index` values, which is only stable
   * while the list never moves. It moves: the search above re-orders and
   * shortens it, and `onAddMembers` rewrites `items` after a successful add. An
   * index-keyed set survives neither, so a tick would silently transfer to
   * whoever happened to land at that position.
   */
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  readonly selectedCount = computed(() => this.selectedIds().size);

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
  }

  toggleItem(id: string): void {
    this.selectedIds.update((ids) => {
      const next = new Set(ids);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  onSubmit(): void {
    const currentForm = this.form();

    if (this.variant() === 'confirmation') {
      this.submit.emit([]);
      return;
    }

    if (this.variant() === 'form') {
      if (!currentForm) {
        return;
      }
      if (currentForm.valid) {
        this.submit.emit(currentForm.value);
      } else {
        this.markFormGroupTouched(currentForm);
        // "Check all required fields and try again" describes what to do
        // without saying which field or what rule it broke — and this modal is
        // the only thing on screen, so there is nowhere else to look it up.
        toast.error('Please correct the form errors', {
          description: summarizeFormErrors(currentForm),
        });
      }
      return;
    }

    const selectedItemIds = [...this.selectedIds()];

    /*
     * Refuses on the selection rather than on the list.
     *
     * This used to check `items` and complain "due to nothing being selected"
     * when the list was empty — which is a different fault — while an empty
     * *selection* fell through and emitted `[]`, sending a request to add
     * nobody.
     */
    if (selectedItemIds.length === 0) {
      toast.error('Nothing selected', {
        description: 'Choose at least one person first.',
      });
      return;
    }

    this.submit.emit(selectedItemIds);
    this.selectedIds.set(new Set());
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((key) => {
      const control = formGroup.get(key);
      control?.markAsTouched();

      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }
}
