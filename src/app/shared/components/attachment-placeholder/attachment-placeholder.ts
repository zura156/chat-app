import { Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideFile,
  lucideFileText,
  lucideFileSpreadsheet,
  lucideFileArchive,
  lucideFileType,
  lucideImage,
  lucideMic,
  lucideShieldAlert,
  lucideTriangleAlert,
  lucideVideo,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { AttachmentI } from '../../../features/messages/interfaces/message.interface';
import { FileSizePipe } from '../../pipes/file-size.pipe';
import { FileVisualPipe } from '../../pipes/file-visual.pipe';

/** How much room the placeholder has, so it matches what will replace it. */
export type AttachmentPlaceholderShape =
  | 'image' // single large image/video bubble
  | 'grid' // one cell of a 2-column media grid
  | 'tile' // fills whatever square its parent gives it
  | 'video'
  | 'audio'
  | 'file';

/**
 * What an attachment looks like before — or instead of — the real thing.
 *
 * Every attachment goes through a queue: uploaded, then resized or transcoded
 * by a worker, and only then does a URL exist. The placeholders for that window
 * had grown apart: video said "Processing..." with an icon, files showed their
 * name, and images and audio were bare grey rectangles that gave no clue
 * whether anything was happening or the message was simply broken.
 *
 * Worse, the image branches used a plain `@else`, so `failed` and `infected`
 * attachments — which are never going to arrive — rendered the same shimmering
 * skeleton forever. A permanent loading state is the one thing a placeholder
 * must never be.
 *
 * All three outcomes are handled here, once.
 */
@Component({
  selector: 'app-attachment-placeholder',
  imports: [
    NgIcon,
    HlmIcon,
    HlmSkeleton,
    HlmSpinner,
    FileVisualPipe,
  ],
  providers: [
    provideIcons({
      lucideImage,
      lucideVideo,
      lucideMic,
      lucideFile,
      lucideFileText,
      lucideFileSpreadsheet,
      lucideFileArchive,
      lucideFileType,
      lucideTriangleAlert,
      lucideShieldAlert,
    }),
  ],
  template: `
    @if (state() === 'processing') {
      @switch (shape()) {
        @case ('file') {
          <!--
            The name and size are known from the moment the upload starts, so
            the row can show what it is rather than two grey bars.
          -->
          @let visual = attachment()?.originalName | fileVisual;
          <div
            class="m-1 flex w-fit max-w-full items-center gap-2 rounded-md border border-border px-3 py-2"
          >
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-md"
              [class]="visual.bg"
            >
              <ng-icon hlm [name]="visual.icon" size="sm" />
            </div>
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-xs font-medium">
                {{ attachment()?.originalName ?? 'File' }}
              </span>
              <span
                class="flex items-center gap-x-1.5 text-[11px] text-muted-foreground"
              >
                <hlm-spinner class="size-2.5" />
                Processing{{ sizeSuffix() }}
              </span>
            </div>
          </div>
        }

        @case ('audio') {
          <!--
            A dimmed copy of the player that is about to replace it: the same
            round button, the same 28 bars, the same clock in the same place.
            It was a spinner beside the words "Processing voice message", which
            is a different shape and a different width, so the bubble visibly
            resized and rearranged the moment the worker finished.

            Drawn in currentColor for the same reason as the player — it sits
            inside the message bubble and has to read on either background.
          -->
          <div class="flex w-full animate-pulse items-center gap-2 opacity-60">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-current/15"
            >
              <hlm-spinner class="size-3.5" />
            </span>

            <div class="flex h-8 flex-1 items-center gap-px">
              @for (bar of idleBars; track $index) {
                <span
                  class="min-w-px flex-1 rounded-full bg-current opacity-30"
                  [style.height.%]="bar * 100"
                ></span>
              }
            </div>

            <span class="h-3 w-8 shrink-0 rounded bg-current/20"></span>
          </div>
        }

        @default {
          <div class="relative" [class]="boxClass()">
            <hlm-skeleton class="size-full rounded-xl" />
            <div
              class="absolute inset-0 flex flex-col items-center justify-center gap-y-1.5"
            >
              <ng-icon
                hlm
                [name]="mediaIcon()"
                [size]="isCompact() ? 'sm' : 'lg'"
                class="text-muted-foreground"
              />
              <!--
                A grid cell is 128px and already carries the media icon; adding
                a word to it just crowds the tile. The spinner alone is enough
                to say "working" at that size.
              -->
              @if (isCompact()) {
                <hlm-spinner class="size-3 text-muted-foreground" />
              } @else {
                <span
                  class="flex items-center gap-x-1.5 text-xs text-muted-foreground"
                >
                  <hlm-spinner class="size-3" />
                  Processing
                </span>
              }
            </div>
          </div>
        }
      }
    } @else {
      <!--
        A terminal state. Sized like the thing it replaces so the bubble does
        not jump, but visibly finished rather than pending.
      -->
      <div
        class="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        [class]="isBoxed() ? boxClass() : ''"
        [class.flex-col]="isBoxed()"
        [class.justify-center]="isBoxed()"
        [class.text-center]="isBoxed()"
      >
        <ng-icon
          hlm
          [name]="
            state() === 'infected' ? 'lucideShieldAlert' : 'lucideTriangleAlert'
          "
          size="sm"
          class="shrink-0"
        />
        <span>{{ failureText() }}</span>
      </div>
    }
  `,
})
export class AttachmentPlaceholder {
  readonly attachment = input<AttachmentI | null | undefined>();
  readonly shape = input<AttachmentPlaceholderShape>('image');

  /**
   * A resting waveform for the audio placeholder — 28 bars, matching the
   * player's count so the shape does not change when the real one arrives.
   *
   * Deliberately a fixed, gentle shape rather than random heights: this stands
   * in for a sound nobody has heard yet, and inventing a plausible-looking
   * waveform for it would be claiming to know something.
   */
  readonly idleBars = Array.from({ length: 28 }, (_, index) => {
    const wave = Math.sin((index / 27) * Math.PI); // low at the ends, full in the middle
    return 0.25 + wave * 0.35;
  });

  /**
   * `processing` is the default for an attachment with no status yet — an
   * optimistic message that has not round-tripped. Treating unknown as pending
   * is right: it is the state it is about to be in.
   */
  readonly state = computed<'processing' | 'failed' | 'infected'>(() => {
    const status = this.attachment()?.status;
    if (status === 'infected') return 'infected';
    if (status === 'failed') return 'failed';
    return 'processing';
  });

  readonly failureText = computed(() =>
    this.state() === 'infected'
      ? 'Blocked — failed security scan'
      : "Couldn't be processed",
  );

  readonly mediaIcon = computed(() =>
    this.shape() === 'video' ? 'lucideVideo' : 'lucideImage',
  );

  /** Small square cells — no room for a caption beside the icon. */
  readonly isCompact = computed(
    () => this.shape() === 'grid' || this.shape() === 'tile',
  );

  /**
   * Shapes that occupy a fixed box, so the failure state has to fill the same
   * space rather than collapse to a text row and shift everything around it.
   */
  readonly isBoxed = computed(() => this.isCompact() || this.shape() === 'image');

  readonly boxClass = computed(() => {
    switch (this.shape()) {
      case 'grid':
        return 'size-32';
      // The media grid in conversation details sizes its own cells, so this
      // takes whatever it is given rather than imposing a width.
      case 'tile':
        return 'size-full';
      case 'video':
        return 'w-64 h-48';
      default:
        return 'w-64 h-64';
    }
  });

  /** Size is only known once the file is picked; omit it rather than show 0 B. */
  readonly sizeSuffix = computed(() => {
    const bytes = this.attachment()?.fileSize;
    return bytes ? ` · ${new FileSizePipe().transform(bytes)}` : '';
  });
}
